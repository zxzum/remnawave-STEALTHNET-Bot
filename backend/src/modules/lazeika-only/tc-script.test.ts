import assert from "node:assert/strict";
import test from "node:test";

const {
  buildTcScript,
  buildTcUnit,
  validateInterface,
  validatePort,
  validateSpeed,
  ownedPrefs,
  TC_PREF_BASE,
  TC_PREF_COUNT,
  TC_POLICE_INDEX_INGRESS,
  TC_POLICE_INDEX_EGRESS,
} = await import("./tc-script.js");

test("aggregate limiter: exactly TWO shared police buckets, filters reference by index", () => {
  const script = buildTcScript({ iface: "eth0", port: 40001, speedMbit: 5 });
  // Ровно одна замена общего action на направление (replace, не per-filter police).
  const replaces = script.match(/tc actions replace action police rate 5mbit/g) ?? [];
  assert.equal(replaces.length, 2, "один общий bucket на ingress и один на egress");
  // Все классификаторы ссылаются на общие индексы — собственных per-filter bucket'ов нет.
  assert.ok(!/flower[^\n]*police rate/.test(script), "фильтры не создают собственные police");
  const flowerLines = script.split("\n").filter((l) => l.includes("flower"));
  const ingressRefs = flowerLines.filter((l) => l.includes(`index ${TC_POLICE_INDEX_INGRESS}`)).length;
  const egressRefs = flowerLines.filter((l) => l.includes(`index ${TC_POLICE_INDEX_EGRESS}`)).length;
  assert.equal(ingressRefs, 4, "4 ingress-классификатора на общем bucket");
  assert.equal(egressRefs, 4, "4 egress-классификатора на общем bucket");
});

test("prefs are normalized to 11000..11007 and legacy range is migrated", () => {
  const script = buildTcScript({ iface: "eth0", port: 40001, speedMbit: 5 });
  assert.deepEqual(ownedPrefs(), Array.from({ length: TC_PREF_COUNT }, (_, i) => TC_PREF_BASE + i));
  for (const pref of ownedPrefs()) {
    assert.ok(script.includes(`pref ${pref}`), `pref ${pref} присутствует`);
  }
  // Миграция: legacy 11001..11008 снимаются до установки нового набора.
  for (const legacy of [11001, 11004, 11008]) {
    assert.ok(script.includes(`pref ${legacy} 2>/dev/null || true`), `legacy pref ${legacy} удаляется`);
  }
});

test("remoteInstall hard-fails: set -euo pipefail + self-check of all prefs/police/unit", () => {
  const script = buildTcScript({ iface: "eth0", port: 40001, speedMbit: 5 });
  assert.match(script, /^#!\/usr\/bin\/env bash\nset -euo pipefail/);
  for (const pref of ownedPrefs()) {
    assert.ok(script.includes(`grep -q "pref ${pref} "`), `самопроверка pref ${pref}`);
  }
  assert.match(script, /PREF_MISSING/);
  assert.match(script, /POLICE_MISSING ingress/);
  assert.match(script, /POLICE_MISSING egress/);
});

test("tc script limits only managed port on both directions, protocols and families", () => {
  const script = buildTcScript({ iface: "eth0", port: 40001, speedMbit: 5 });
  assert.match(script, /ingress pref \d+ .*dst_port "\$PORT"/);
  assert.match(script, /egress pref \d+ .*src_port "\$PORT"/);
  assert.match(script, /ip_proto tcp/);
  assert.match(script, /ip_proto udp/);
  assert.match(script, /protocol ip flower/);
  assert.match(script, /protocol ipv6 flower/);
  assert.doesNotMatch(script, /qdisc add dev "\$IFACE" (?!clsact)/);
  assert.match(script, /qdisc add dev "\$IFACE" clsact/);
});

test("tc validation rejects ssh/service ports, bad interfaces and speeds", () => {
  assert.throws(() => validatePort(22));
  assert.throws(() => validatePort(0));
  assert.throws(() => validatePort(70000));
  assert.equal(validatePort(40001), 40001);
  assert.throws(() => validateInterface("eth0; rm -rf /"));
  assert.throws(() => validateInterface(""));
  assert.equal(validateInterface("eth0"), "eth0");
  assert.throws(() => validateSpeed(0));
  assert.throws(() => validateSpeed(1001));
  assert.throws(() => validateSpeed(2.5));
  assert.equal(validateSpeed(5), 5);
});

test("systemd unit reruns the limiter after boot", () => {
  const unit = buildTcUnit();
  assert.ok(unit.startsWith("[Unit]"));
  assert.match(unit, /After=network-online.target docker.service/);
  assert.match(unit, new RegExp(`ExecStart=.*\\nRemainAfterExit=yes`));
  assert.match(unit, /WantedBy=multi-user.target/);
});

import assert from "node:assert/strict";
import test from "node:test";

const {
  buildTcScript,
  buildTcUnit,
  validateInterface,
  validatePort,
  validateSpeed,
  TC_PREF_BASE,
  TC_UNIT_NAME,
} = await import("./tc-script.js");

test("tc script limits only managed port on both directions, protocols and families", () => {
  const script = buildTcScript({ iface: "eth0", port: 40001, speedMbit: 5 });
  // ingress → dst_port, egress → src_port
  assert.match(script, /ingress pref \d+ .*dst_port "\$PORT"/);
  assert.match(script, /egress pref \d+ .*src_port "\$PORT"/);
  // tcp + udp
  assert.match(script, /ip_proto tcp/);
  assert.match(script, /ip_proto udp/);
  // ipv4 + ipv6
  assert.match(script, /protocol ip flower/);
  assert.match(script, /protocol ipv6 flower/);
  // police rate
  assert.match(script, /police rate 5mbit/);
  // root qdisc не трогаем — только clsact
  assert.doesNotMatch(script, /qdisc add dev "\$IFACE" (?!clsact)/);
  assert.match(script, /qdisc add dev "\$IFACE" clsact/);
});

test("tc script is idempotent: deletes own prefs before re-adding", () => {
  const script = buildTcScript({ iface: "eth0", port: 40001, speedMbit: 5 });
  const dels = script.match(/tc filter del dev "\$IFACE" \w+ pref \d+/g) ?? [];
  assert.equal(dels.length, 8); // {ip,ipv6} x {ingress,egress} x {tcp,udp}
  for (let i = 1; i <= 8; i++) {
    assert.ok(script.includes(`pref ${TC_PREF_BASE + i}`), `own pref ${TC_PREF_BASE + i} present`);
  }
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
  assert.ok(unit.includes("lazeika-only-tc.service") || TC_UNIT_NAME.length > 0);
});

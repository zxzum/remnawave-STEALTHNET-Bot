import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const {
  applyLazeikaToConfig,
  buildRoutingRules,
  buildManagedInbound,
  managedInboundTag,
  pickManagedPort,
  XrayConfigError,
} = await import("./xray-rules.js");
const { validateMessageTemplate, renderGraceMessage, resourceStateSchema } = await import("./lazeika-only.config.js");

const baseConfig = (): import("./xray-rules.js").XrayConfig => ({
  log: { loglevel: "warning" },
  inbounds: [
    {
      tag: "VLESS-REALITY",
      port: 443,
      protocol: "vless",
      settings: { clients: [], decryption: "none" },
      streamSettings: { network: "tcp", security: "reality", realitySettings: { serverNames: ["google.com"] } },
      sniffing: { enabled: true, destOverride: ["tls"] },
    },
  ],
  outbounds: [
    { protocol: "freedom", tag: "DIRECT" },
    { protocol: "blackhole", tag: "BLOCK" },
  ],
  routing: { rules: [{ inboundTag: ["OTHER"], domain: ["domain:example.com"], outboundTag: "DIRECT" }] },
});

test("routing rules allow only telegram + lazeika.xyz for the managed inboundTag and block the rest", () => {
  const rules = buildRoutingRules("LAZEIKA_IN", "BLOCK");
  assert.equal(rules.length, 3);
  assert.deepEqual(rules[0].inboundTag, ["LAZEIKA_IN"]);
  assert.deepEqual(rules[0].domain, ["geosite:telegram"]);
  // Контракт Xray: поле outboundTag (не outbound).
  assert.equal(rules[0].outboundTag, "DIRECT");
  assert.deepEqual(rules[1].domain, ["domain:lazeika.xyz"]); // покрывает все поддомены
  assert.equal(rules[2].outboundTag, "BLOCK"); // catch-all для нашего inbound
  assert.ok(rules.every((r) => !("outbound" in r)), "поле outbound недопустимо");
});

test("managed inbound is a deep clone with new tag/port and sniffing enabled", () => {
  const base = baseConfig().inbounds![0];
  const managed = buildManagedInbound(base, "LAZEIKA_IN", 40001) as Record<string, unknown>;
  assert.equal(managed.tag, "LAZEIKA_IN");
  assert.equal(managed.port, 40001);
  const sniffing = managed.sniffing as { enabled: boolean; destOverride: string[] };
  assert.equal(sniffing.enabled, true);
  assert.ok(sniffing.destOverride.includes("http"));
  // оригинал не мутирован
  assert.equal((base as Record<string, unknown>).tag, "VLESS-REALITY");
});

test("applyLazeikaToConfig adds inbound+rules without touching foreign rules (idempotent)", () => {
  const first = applyLazeikaToConfig(baseConfig(), baseConfig().inbounds![0], "LAZEIKA_IN", 40001);
  assert.equal(first.config.inbounds?.length, 2);
  assert.equal(first.rulesAdded, 3);

  // повторный прогон по уже настроенному конфигу не дублирует
  const second = applyLazeikaToConfig(first.config, baseConfig().inbounds![0], "LAZEIKA_IN", 40001);
  assert.equal(second.config.inbounds?.length, 2);
  assert.equal(second.config.routing?.rules?.filter((r) => Array.isArray(r.inboundTag) && r.inboundTag.includes("LAZEIKA_IN")).length, 3);
  // чужое правило выжило
  assert.ok(second.config.routing.rules.some((r) => JSON.stringify(r).includes("example.com")));
});

test("applyLazeikaToConfig fails without BLOCK outbound", () => {
  const cfg = baseConfig();
  cfg.outbounds = [{ protocol: "freedom", tag: "DIRECT" }];
  assert.throws(() => applyLazeikaToConfig(cfg, cfg.inbounds![0], "T", 40001), XrayConfigError);
});

test("managed rules are inserted BEFORE the global catch-all", () => {
  // Реальный профиль проекта: в конце стоит catch-all network tcp,udp → auto-wl.
  const cfg = baseConfig();
  cfg.routing = { rules: [{ type: "field", network: "tcp,udp", outboundTag: "auto-wl" }] };
  const { config } = applyLazeikaToConfig(cfg, baseConfig().inbounds![0], "LAZEIKA_IN", 40001);
  const first = config.routing?.rules?.[0] as Record<string, unknown>;
  assert.deepEqual(first.inboundTag, ["LAZEIKA_IN"], "первое правило должно быть managed");
  const catchAllIndex = config.routing!.rules!.findIndex((r) => (r as { outboundTag?: string }).outboundTag === "auto-wl");
  const managedIndexes = config.routing!.rules!
    .map((r, i) => (Array.isArray((r as { inboundTag?: string[] }).inboundTag) && ((r as { inboundTag?: string[] }).inboundTag as string[]).includes("LAZEIKA_IN") ? i : -1))
    .filter((i) => i >= 0);
  assert.ok(managedIndexes.every((i) => i < catchAllIndex), "catch-all не должен перехватывать трафик managed inbound");
});

test("pickManagedPort avoids used and forbidden ports", () => {
  const port = pickManagedPort(baseConfig(), [40001]);
  assert.equal(port, 40002);
  assert.throws(() => pickManagedPort({ inbounds: [] }, Array.from({ length: 200 }, (_, i) => 40000 + i + 1)));
});

test("managed inbound tag is a stable marker with short uuid", () => {
  const tag = managedInboundTag("aabbccdd-1234-5678-9abc-def012345678");
  assert.match(tag, /^LAZEIKA_ONLY_INBOUND_[A-F0-9]{8}$/);
});

test("message template validation allows only {count} placeholder", () => {
  assert.equal(validateMessageTemplate("✅ Доступ сохранён ещё на {count} дней!"), true);
  assert.equal(validateMessageTemplate("Простой текст"), true);
  assert.equal(validateMessageTemplate(""), false);
  assert.equal(validateMessageTemplate("{days} дней"), false);
  assert.equal(validateMessageTemplate("{count} {unknown}"), false);
  assert.equal(validateMessageTemplate("x".repeat(1001)), false);
});

test("renderGraceMessage substitutes count with minimum of 1", () => {
  assert.equal(renderGraceMessage("осталось {count} дней", 5), "осталось 5 дней");
  assert.equal(renderGraceMessage("осталось {count} дней", 0), "осталось 1 дней");
});

test("resource state parses defaults from empty and rejects secrets shape", () => {
  const empty = resourceStateSchema.parse({});
  assert.equal(empty.status, "UNCONFIGURED");
  assert.equal(empty.squadSource, "AUTO");
  assert.deepEqual(empty.notificationHostUuids, []);
});

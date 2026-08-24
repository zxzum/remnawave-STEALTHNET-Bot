import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const config = await import("./lazeika-only.config.js");
const { prisma } = await import("../../db.js");

test("saveResourceState issues a FULL upsert (where+create+update)", async () => {
  const delegate = prisma.systemSetting as unknown as Record<string, unknown>;
  const originalUpsert = delegate.upsert;
  const calls: Array<Record<string, unknown>> = [];
  delegate.upsert = async (args: Record<string, unknown>) => {
    calls.push(args);
    return {};
  };
  try {
    await config.saveResourceState(config.resourceStateSchema.parse({ status: "READY" }));
    assert.equal(calls.length, 1);
    const args = calls[0];
    // where по ключу
    assert.deepEqual(args.where, { key: config.LAZEIKA_STATE_KEY });
    // create содержит ключ и значение
    const create = args.create as Record<string, string>;
    assert.equal(create.key, config.LAZEIKA_STATE_KEY);
    assert.ok(create.value.includes('"status":"READY"'));
    // КРИТИЧНО: update присутствует и содержит то же значение (иначе состояние не сохраняется)
    const update = args.update as Record<string, string> | undefined;
    assert.ok(update, "upsert обязан содержать update");
    assert.equal(update.value, create.value);
  } finally {
    delegate.upsert = originalUpsert;
  }
});

test("casUpdateResourceState writes only when expected raw matches", async () => {
  const delegate = prisma.systemSetting as unknown as Record<string, unknown>;
  const originalUpdateMany = delegate.updateMany;
  let capturedWhere: Record<string, unknown> | null = null;
  delegate.updateMany = async (args: Record<string, unknown>) => {
    capturedWhere = args.where as Record<string, unknown>;
    return { count: 1 };
  };
  try {
    const next = config.resourceStateSchema.parse({ status: "APPLYING" });
    const res = await config.casUpdateResourceState("EXPECTED_RAW", next);
    assert.equal(res.ok, true);
    assert.deepEqual(capturedWhere, { key: config.LAZEIKA_STATE_KEY, value: "EXPECTED_RAW" });
  } finally {
    delegate.updateMany = originalUpdateMany;
  }
});

test("settingsInSync/ready=false when panel speed differs from applied tc rate", async () => {
  const delegate = prisma.systemSetting as unknown as Record<string, unknown>;
  const originalFindUnique = delegate.findUnique;
  const NODE = "11111111-1111-1111-1111-111111111111";
  const PROFILE = "22222222-2222-2222-2222-222222222222";
  const SQUAD = "33333333-3333-3333-3333-333333333333";
  const INBOUND = "44444444-4444-4444-4444-444444444444";
  const stateRaw = JSON.stringify(config.resourceStateSchema.parse({
    status: "READY",
    nodeUuid: NODE,
    profileUuid: PROFILE,
    squadUuid: SQUAD,
    managedInboundUuid: INBOUND,
    ssh: { interface: "eth0", rateMbit: 5 },
  }));
  delegate.findUnique = async () => ({ key: config.LAZEIKA_STATE_KEY, value: stateRaw });
  try {
    const base = {
      lazeikaOnlyEnabled: true,
      lazeikaOnlyNodeUuid: NODE,
      lazeikaOnlySquadUuid: SQUAD,
      lazeikaOnlySpeedMbit: 5,
    };
    const inSync = await config.getLazeikaConfig(base);
    assert.equal(inSync.settingsInSync, true, "скорость совпадает с применённой — синхронно");
    assert.equal(inSync.ready, true);

    // Админ поднял лимит 5 → 10 Mbit в настройках, но tc ещё не перенастроен.
    const drifted = await config.getLazeikaConfig({ ...base, lazeikaOnlySpeedMbit: 10 });
    assert.equal(drifted.settingsInSync, false, "скорость разошлась с state.ssh.rateMbit");
    assert.equal(drifted.ready, false, "grace не выдаётся при устаревшем tc-лимите");
  } finally {
    delegate.findUnique = originalFindUnique;
  }
});

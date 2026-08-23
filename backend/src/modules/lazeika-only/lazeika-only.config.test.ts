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

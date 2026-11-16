import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://guard-test:guard-test@127.0.0.1:5432/guard-test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.INVOXY_ONLY = "true";

const { prisma } = await import("../../db.js");
const { processAutoRenewals } = await import("./auto-renew.cron.js");

test("auto-renew tick does nothing under INVOXY_ONLY", async () => {
  const db = prisma as unknown as Record<string, Record<string, unknown>>;
  const calls: string[] = [];
  const orig = { cfind: db.client.findMany, pcreate: db.payment.create, sfind: db.systemSetting?.findMany };
  db.client.findMany = async () => { calls.push("client.findMany"); return []; };
  db.payment.create = async () => { calls.push("payment.create"); return {}; };
  try {
    await processAutoRenewals();
    assert.deepEqual(calls, []);
  } finally {
    db.client.findMany = orig.cfind;
    db.payment.create = orig.pcreate;
  }
});

import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://guard-test:guard-test@127.0.0.1:5432/guard-test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.INVOXY_ONLY = "true";
// панель «настроена»: без защиты флагом крон дошёл бы до выборки клиентов
process.env.REMNA_API_URL ??= "https://panel.example.test";
process.env.REMNA_ADMIN_TOKEN ??= "test-token";

const { prisma } = await import("../../db.js");
const { processAutoRenewals } = await import("./auto-renew.cron.js");

test("auto-renew tick does nothing under INVOXY_ONLY", async () => {
  const db = prisma as unknown as Record<string, Record<string, unknown>>;
  const calls: string[] = [];
  const orig = { cfind: db.client.findMany, pcreate: db.payment.create, sfind: db.systemSetting?.findMany };
  db.client.findMany = async () => { calls.push("client.findMany"); return []; };
  db.payment.create = async () => { calls.push("payment.create"); return {}; };
  const sset = db.systemSetting as Record<string, unknown>;
  const origS = { findMany: sset.findMany, findUnique: sset.findUnique, findFirst: sset.findFirst };
  sset.findMany = async () => []; sset.findUnique = async () => null; sset.findFirst = async () => null;
  try {
    await processAutoRenewals();
    assert.deepEqual(calls, []);
  } finally {
    db.client.findMany = orig.cfind;
    db.payment.create = orig.pcreate;
    Object.assign(sset, origS);
  }
});

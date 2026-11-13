import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://guard-test:guard-test@127.0.0.1:5432/guard-test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { prisma } = await import("../../db.js");
const { activateTariffByPaymentId } = await import("../tariff/tariff-activation.service.js");

test("a blocked client's payment is held and never activated", async () => {
  const updates: unknown[] = [];
  const payment = prisma.payment as unknown as Record<string, unknown>;
  const db = prisma as unknown as Record<string, unknown>;
  const original = { findUnique: payment.findUnique, update: payment.update, $transaction: db.$transaction };
  payment.findUnique = async () => ({
    id: "p1", clientId: "c1", amount: 100, currency: "RUB", status: "PAID", metadata: null, extraOptionState: null,
    client: { id: "c1", isBlocked: true, blockReason: "Мигрирован в Invoxy" },
  });
  payment.update = async (args: unknown) => { updates.push(args); return {}; };
  db.$transaction = async () => { throw new Error("activation must not start"); };
  try {
    const result = await activateTariffByPaymentId("p1");
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 403);
    assert.match(JSON.stringify(updates), /blockedClientHold/);
  } finally {
    Object.assign(payment, { findUnique: original.findUnique, update: original.update });
    db.$transaction = original.$transaction;
  }
});

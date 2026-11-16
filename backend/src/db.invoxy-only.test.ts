import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://guard-test:guard-test@127.0.0.1:5432/guard-test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.INVOXY_ONLY = "true";

const { prisma, createPayment, INVOXY_PAY_TEXT } = await import("./db.js");

test("createPayment refuses under INVOXY_ONLY and writes nothing", async () => {
  const payment = prisma.payment as unknown as Record<string, unknown>;
  const original = payment.create;
  let writes = 0;
  payment.create = async () => { writes++; return {}; };
  try {
    await assert.rejects(
      createPayment({ data: { clientId: "c1", orderId: "o1", amount: 100, currency: "RUB", provider: "platega" } as never }),
      (e: Error & { code?: string }) => e.code === "INVOXY_ONLY" && e.message === INVOXY_PAY_TEXT,
    );
    assert.equal(writes, 0);
    // выдача админом — не оплата
    await createPayment({ data: { clientId: "c1", orderId: "o2", amount: 0, currency: "RUB", provider: "admin_grant" } as never });
    assert.equal(writes, 1);
  } finally {
    payment.create = original;
  }
});

test("createPayment works as before when the flag is off", async () => {
  const payment = prisma.payment as unknown as Record<string, unknown>;
  const original = payment.create;
  let writes = 0;
  payment.create = async () => { writes++; return {}; };
  process.env.INVOXY_ONLY = "false";
  try {
    await createPayment({ data: { clientId: "c1", orderId: "o3", amount: 100, currency: "RUB", provider: "platega" } as never });
    assert.equal(writes, 1);
  } finally {
    process.env.INVOXY_ONLY = "true";
    payment.create = original;
  }
});

import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const yookassa = await import("./yookassa.service.js") as unknown as {
  validateYookassaPayment?: (
    localPayment: { id: string; externalId?: string | null; amount: number; currency: string },
    remotePayment: { id?: string; status?: string; amount?: { value?: string; currency?: string } } | null,
    expectedId: string,
  ) => { ok: boolean };
};

test("rejects a confirmed YooKassa payment when its amount differs locally", () => {
  assert.equal(typeof yookassa.validateYookassaPayment, "function");
  const result = yookassa.validateYookassaPayment?.(
    { id: "local-payment", amount: 100, currency: "RUB" },
    { id: "yk-payment", status: "succeeded", amount: { value: "99.99", currency: "RUB" } },
    "yk-payment",
  );
  assert.equal(result?.ok, false);
});

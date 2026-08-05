import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret-at-least-thirty-two-characters";

const { validatePlategaTransaction, verifyPlategaCallbackCredentials } = await import("./platega/platega.service.js");

const config = { merchantId: "merchant-id", secret: "secret-key" };
const payment = { externalId: "tx-1", orderId: "order-1", amount: 100.25, currency: "RUB" };
const transaction = { id: "tx-1", status: "CONFIRMED", amount: 100.25, currency: "rub", payload: "order-1", raw: {} };

test("Platega callback requires exact merchant credentials", () => {
  assert.equal(verifyPlategaCallbackCredentials({ "X-MerchantId": "merchant-id", "X-Secret": "secret-key" }, config), true);
  assert.equal(verifyPlategaCallbackCredentials({ "x-merchantid": "merchant-id", "x-secret": "wrong" }, config), false);
  assert.equal(verifyPlategaCallbackCredentials({}, config), false);
});

test("Platega transaction must match id, amount, currency and payload", () => {
  assert.equal(validatePlategaTransaction(transaction, payment), null);
  assert.equal(validatePlategaTransaction({ ...transaction, id: "other" }, payment), "transaction id mismatch");
  assert.equal(validatePlategaTransaction({ ...transaction, amount: 1 }, payment), "amount mismatch");
  assert.equal(validatePlategaTransaction({ ...transaction, currency: "USD" }, payment), "currency mismatch");
  assert.equal(validatePlategaTransaction({ ...transaction, payload: "other" }, payment), "payload mismatch");
});

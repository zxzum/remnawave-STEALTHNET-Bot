import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret-at-least-thirty-two-characters";

const { validateRollypayPayment } = await import("../rollypay/rollypay.service.js");

const localPayment = {
  id: "local-1",
  orderId: "order-1",
  externalId: null,
  amount: 100,
  currency: "RUB",
};

const webhook = {
  payment_id: "rp-1",
  order_id: "order-1",
  status: "paid",
  amount: "100.00",
  currency: "RUB",
};

const remotePayment = {
  payment_id: "rp-1",
  order_id: "order-1",
  amount: "100.00",
  payment_currency: "RUB",
  status: "paid",
};

test("accepts a paid remote payment with canonical 100.00 amounts", () => {
  assert.deepEqual(validateRollypayPayment(localPayment, webhook, remotePayment), { ok: true });
});

test("rejects a remote payment id that differs from the signed webhook", () => {
  const result = validateRollypayPayment(localPayment, webhook, { ...remotePayment, payment_id: "rp-other" });
  assert.equal(result.ok, false);
});

test("rejects a remote order id that differs from the local payment", () => {
  const result = validateRollypayPayment(localPayment, webhook, { ...remotePayment, order_id: "order-other" });
  assert.equal(result.ok, false);
});

test("rejects a remote amount that differs from the local payment", () => {
  const result = validateRollypayPayment(localPayment, webhook, { ...remotePayment, amount: "99.99" });
  assert.equal(result.ok, false);
});

test("rejects extra amount precision instead of rounding it to cents", () => {
  const result = validateRollypayPayment(localPayment, webhook, { ...remotePayment, amount: "99.996" });
  assert.equal(result.ok, false);
});

test("rejects a non-RUB or unpaid remote payment", () => {
  assert.equal(validateRollypayPayment(localPayment, webhook, { ...remotePayment, payment_currency: "USD" }).ok, false);
  assert.equal(validateRollypayPayment(localPayment, webhook, { ...remotePayment, status: "pending" }).ok, false);
});

test("rejects a local payment whose stored provider id differs", () => {
  const result = validateRollypayPayment({ ...localPayment, externalId: "rp-other" }, webhook, remotePayment);
  assert.equal(result.ok, false);
});

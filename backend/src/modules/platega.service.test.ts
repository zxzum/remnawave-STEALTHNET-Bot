import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret-at-least-thirty-two-characters";

const { validatePlategaTransaction, verifyPlategaCallbackCredentials, isPlategaErrorNotificationSuppressed, forwardPlategaCallback } = await import("./platega/platega.service.js");

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
  assert.equal(validatePlategaTransaction({ ...transaction, amount: 107, raw: { comission: 6.75 } }, { ...payment, amount: 100.25 }), null);
  assert.equal(validatePlategaTransaction({ ...transaction, amount: 107, raw: {} }, { ...payment, amount: 100.25 }, true), null);
});

test("repeated Platega error notifications are suppressed only for the same incident", () => {
  const sentAt = "2026-08-15T00:00:00.000Z";
  assert.equal(isPlategaErrorNotificationSuppressed("callback_failed:payment:error", sentAt, "callback_failed:payment:error", Date.parse(sentAt) + 5 * 60 * 60_000), true);
  assert.equal(isPlategaErrorNotificationSuppressed("callback_failed:payment:error", sentAt, "callback_failed:payment:other-error", Date.parse(sentAt) + 5 * 60 * 60_000), false);
  assert.equal(isPlategaErrorNotificationSuppressed("callback_failed:payment:error", sentAt, "callback_failed:payment:error", Date.parse(sentAt) + 6 * 60 * 60_000), false);
});

test("unknown Platega callbacks can be forwarded unchanged to a HTTPS fallback", async () => {
  const body = Buffer.from('{"id":"tx-2","status":"CONFIRMED"}');
  let request: { url: string; init?: RequestInit } | undefined;
  const response = await forwardPlategaCallback(
    "https://invoxy.my/platega-webhook",
    body,
    config,
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      request = { url: String(input), init };
      return new Response(null, { status: 200 });
    },
  );

  assert.equal(response.status, 200);
  assert.equal(request?.url, "https://invoxy.my/platega-webhook");
  assert.equal(request?.init?.body, body);
  assert.deepEqual(request?.init?.headers, {
    "Content-Type": "application/json",
    "X-MerchantId": "merchant-id",
    "X-Secret": "secret-key",
  });
  await assert.rejects(() => forwardPlategaCallback("http://invoxy.my/platega-webhook", body, config));
});

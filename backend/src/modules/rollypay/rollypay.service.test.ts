import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret-at-least-thirty-two-characters";

const {
  createRollypayPayment,
  isRollypayConfigured,
  rollypayPaymentLookupFailure,
  verifyRollypayWebhookSignature,
} = await import("./rollypay.service.js");

const config = { apiKey: "api-key", signingSecret: "signing-secret" };
const rawBody = '{"event_type":"payment.paid","payment_id":"rp-1"}';

function signature(timestamp: string, body = rawBody): string {
  return createHmac("sha256", config.signingSecret).update(`${timestamp}.${body}`).digest("hex");
}

test("accepts a valid signature over the exact raw body", () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  assert.equal(verifyRollypayWebhookSignature(config.signingSecret, rawBody, timestamp, signature(timestamp)), true);
});

test("rejects a signature when the raw body changes", () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  assert.equal(verifyRollypayWebhookSignature(config.signingSecret, `${rawBody} `, timestamp, signature(timestamp)), false);
});

test("rejects a stale webhook timestamp", () => {
  const timestamp = String(Math.floor(Date.now() / 1000) - 901);
  assert.equal(verifyRollypayWebhookSignature(config.signingSecret, rawBody, timestamp, signature(timestamp)), false);
});

test("requires both RollyPay credentials", () => {
  assert.equal(isRollypayConfigured(config), true);
  assert.equal(isRollypayConfigured({ apiKey: "api-key", signingSecret: "" }), false);
});

test("rejects non-RUB payments before making an API request", async () => {
  const result = await createRollypayPayment({
    config,
    amount: "100.00",
    currency: "USD",
    orderId: "order-1",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /только рубли/);
});

test("classifies remote failures so transient lookups can be retried", () => {
  const transient = rollypayPaymentLookupFailure("upstream unavailable", 503);
  const rejected = rollypayPaymentLookupFailure("not found", 404);
  assert.equal(transient.kind, "transient");
  assert.equal(rejected.kind, "remote_rejection");
});

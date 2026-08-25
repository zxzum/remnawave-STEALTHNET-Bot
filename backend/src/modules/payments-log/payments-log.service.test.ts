import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";

const service = await import("./payments-log.service.js");

test("provider EXPIRED is shown as a timeout instead of a generic cancellation", () => {
  assert.equal(service.providerStatusReason("EXPIRED"), "Истёк срок оплаты (timeout)");
  assert.equal(service.getPaymentLogReason({ status: "CANCELED", rawStatus: "EXPIRED" }), "Истёк срок оплаты (timeout)");
});

test("callback error text has priority over a generic outcome label", () => {
  assert.equal(
    service.getPaymentLogReason({
      status: "FAILED",
      outcome: "error",
      errorMessage: "Platega вернула HTTP 502",
    }),
    "Platega вернула HTTP 502",
  );
});

test("callback outcomes are explained when the provider did not send an error text", () => {
  assert.equal(
    service.getPaymentLogReason({ status: "FAILED", outcome: "rejected_payload" }),
    "Данные callback отклонены",
  );
});

test("missing diagnostic data is not invented", () => {
  assert.equal(service.getPaymentLogReason({ status: "FAILED" }), null);
});

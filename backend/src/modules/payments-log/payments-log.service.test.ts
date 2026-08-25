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

test("payment log preserves the client email", () => {
  const paymentToItem = (service as unknown as {
    paymentToItem?: (...args: unknown[]) => { client?: { email?: string | null } | null };
  }).paymentToItem;

  assert.equal(typeof paymentToItem, "function");
  if (!paymentToItem) return;

  const item = paymentToItem(
    {
      id: "payment-1",
      provider: "platega",
      metadata: '{"plategaMethodId":2}',
      source: "site",
      amount: 200,
      currency: "RUB",
      status: "PAID",
      createdAt: new Date("2026-08-25T09:00:00.000Z"),
      paidAt: null,
      orderId: "order-1",
      externalId: "external-1",
      client: {
        id: "client-1",
        email: "user@example.com",
        telegramId: "123",
        telegramUsername: "user",
      },
      tariff: { name: "Стандарт" },
      proxyTariff: null,
      singboxTariff: null,
    },
    { status: "none", at: null, responseStatus: null },
  );

  assert.equal(item.client?.email, "user@example.com");
});

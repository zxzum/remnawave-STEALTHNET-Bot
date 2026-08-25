import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const yookassa = await import("./yookassa.service.js") as unknown as {
  validateYookassaPayment?: (
    localPayment: { id: string; externalId?: string | null; amount: number; currency: string },
    remotePayment: {
      id?: string;
      status?: string;
      amount?: { value?: string; currency?: string };
      metadata?: Record<string, string>;
    } | null,
    expectedId: string,
  ) => { ok: boolean };
  yookassaPaymentLookupFailure?: (error: string, status?: number) => {
    ok: false;
    kind: "transient" | "remote_rejection" | "not_configured";
    status: number;
    error: string;
  };
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

test("requires remote metadata payment_id when no local external id exists", () => {
  const result = yookassa.validateYookassaPayment?.(
    { id: "local-payment", externalId: null, amount: 100, currency: "RUB" },
    { id: "yk-payment", status: "succeeded", amount: { value: "100.00", currency: "RUB" } },
    "yk-payment",
  );
  assert.equal(result?.ok, false);
});

test("distinguishes transient YooKassa failures from remote rejection", () => {
  assert.equal(typeof yookassa.yookassaPaymentLookupFailure, "function");
  const transient = yookassa.yookassaPaymentLookupFailure?.("fetch failed", 503);
  const rejected = yookassa.yookassaPaymentLookupFailure?.("not found", 404);
  assert.equal(transient?.ok, false);
  assert.equal(transient?.kind, "transient");
  assert.equal(transient?.status, 503);
  assert.equal(rejected?.ok, false);
  assert.equal(rejected?.kind, "remote_rejection");
  assert.equal(rejected?.status, 404);
});

test("treats HTTP 408 and transport timeout errors as transient", () => {
  const timeout = yookassa.yookassaPaymentLookupFailure?.("request timeout", 408);
  assert.equal(timeout?.kind, "transient");
  assert.equal(timeout?.status, 408);
  const transport = (yookassa as unknown as { isYookassaTransportTimeout?: (error: unknown) => boolean }).isYookassaTransportTimeout;
  assert.equal(typeof transport, "function");
  assert.equal(transport?.({ name: "AbortError", message: "This operation was aborted" }), true);
});

test("treats not-configured YooKassa lookup as retryable in the webhook route", async () => {
  const source = await readFile(new URL("../webhooks/yookassa.webhooks.routes.ts", import.meta.url), "utf8");
  const lookupStart = source.indexOf("const paymentLookup = await getYookassaPayment");
  const validationStart = source.indexOf("const validation =", lookupStart);
  const lookupBlock = source.slice(lookupStart, validationStart);
  assert.match(lookupBlock, /paymentLookup\.kind === "transient"/);
  assert.match(lookupBlock, /paymentLookup\.kind === "not_configured"/);
  assert.match(lookupBlock, /res\.status\(503\)/);
});

test("returns retryable status for transient YooKassa lookup failures", async () => {
  const source = await readFile(new URL("../webhooks/yookassa.webhooks.routes.ts", import.meta.url), "utf8");
  const lookupStart = source.indexOf("const paymentLookup = await getYookassaPayment");
  const validationStart = source.indexOf("const validation =", lookupStart);
  assert.notEqual(lookupStart, -1);
  assert.notEqual(validationStart, -1);
  const lookupBlock = source.slice(lookupStart, validationStart);
  assert.match(lookupBlock, /if \(!paymentLookup\.ok\)/);
  assert.match(lookupBlock, /paymentLookup\.kind === "transient"/);
  assert.match(lookupBlock, /res\.status\(503\)/);
  assert.match(lookupBlock, /res\.status\(200\)/);
});

test("returns retryable status before post-completion side effects", async () => {
  const source = await readFile(new URL("../webhooks/yookassa.webhooks.routes.ts", import.meta.url), "utf8");
  const markStart = source.indexOf("const result = await markPaymentPaid");
  const failureStatus = source.indexOf("return res.status(503)", markStart);
  const promoSideEffect = source.indexOf("await recordPromoCodeUsageFromPayment", markStart);
  assert.notEqual(markStart, -1);
  assert.notEqual(failureStatus, -1);
  assert.notEqual(promoSideEffect, -1);
  assert.ok(failureStatus < promoSideEffect);
});

test("does not short-circuit a PAID payment with incomplete activation", async () => {
  const source = await readFile(new URL("../webhooks/yookassa.webhooks.routes.ts", import.meta.url), "utf8");
  const guardStart = source.indexOf('if (payment.status === "PAID" && !isExtraOption');
  const markStart = source.indexOf("const result = await markPaymentPaid", guardStart);
  assert.notEqual(guardStart, -1);
  assert.notEqual(markStart, -1);
  assert.match(source.slice(guardStart, markStart), /!shouldRetryPaidActivation\(payment\)/);
});

test("YooKassa PAID guard permits proxy and Sing-box activation recovery", async () => {
  const source = await readFile(new URL("../webhooks/yookassa.webhooks.routes.ts", import.meta.url), "utf8");
  assert.match(source, /shouldRetryPaidSlotActivation/);
  const guardStart = source.indexOf('if (payment.status === "PAID" && !isExtraOption');
  const markStart = source.indexOf("const result = await markPaymentPaid", guardStart);
  assert.match(source.slice(guardStart, markStart), /!shouldRetryPaidSlotActivation\(payment\)/);
});

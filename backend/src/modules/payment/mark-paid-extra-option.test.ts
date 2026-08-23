import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const service = (await import("./mark-paid.service.js")) as Record<string, unknown>;

test("only PAID extra-options with a persisted PENDING plan bypass the idempotent no-op", () => {
  assert.equal(typeof service.shouldRetryPaidExtraOption, "function");
  const shouldRetry = service.shouldRetryPaidExtraOption as (status: string, metadata: string | null, state: "NEEDS_PLAN" | "PLANNING" | "PENDING" | "APPLYING" | "MANUAL_REVIEW" | "APPLIED" | "FAILED_SAFE" | null) => boolean;
  const base = {
    extraOption: { kind: "traffic", trafficBytes: 10 },
    extraOptionApplication: {
      state: "PENDING",
      subscriptionId: "sub-1",
      uuid: "uuid-1",
      remote: { trafficLimitBytes: 100 },
      local: { customPrice: 20 },
    },
  };
  assert.equal(shouldRetry("PAID", JSON.stringify(base), "PENDING"), true);
  assert.equal(shouldRetry("PAID", JSON.stringify(base), "APPLYING"), true);
  assert.equal(shouldRetry("PAID", JSON.stringify(base), "NEEDS_PLAN"), true);
  assert.equal(shouldRetry("PENDING", JSON.stringify(base), "PENDING"), false);
  assert.equal(shouldRetry("PAID", JSON.stringify(base), "APPLIED"), false);
  assert.equal(shouldRetry("PAID", JSON.stringify(base), "MANUAL_REVIEW"), false);
  assert.equal(shouldRetry("PAID", JSON.stringify({ extraOption: base.extraOption }), null), false);
  assert.equal(shouldRetry("PAID", null, null), false);
});

test("a PAID activation failure is retried only until the success marker exists", () => {
  assert.equal(typeof service.shouldRetryPaidActivation, "function");
  const shouldRetry = service.shouldRetryPaidActivation as (payment: {
    status: string;
    tariffId?: string | null;
    proxyTariffId?: string | null;
    singboxTariffId?: string | null;
    metadata?: string | null;
  }) => boolean;
  const failedFirstAttempt = {
    status: "PAID",
    tariffId: "tariff-1",
    metadata: null,
  };
  const completedRetry = {
    ...failedFirstAttempt,
    metadata: JSON.stringify({ subscriptionActivated: true, subscriptionId: "sub-1" }),
  };
  assert.equal(shouldRetry(failedFirstAttempt), true);
  assert.equal(shouldRetry(completedRetry), false);
});

test("PAID recovery reuses canonical activation and never credits balance again", async () => {
  const source = await readFile(new URL("./mark-paid.service.ts", import.meta.url), "utf8");
  const paidStart = source.indexOf('if (payment.status === "PAID")');
  const pendingStart = source.indexOf("const now = new Date()", paidStart);
  assert.notEqual(paidStart, -1);
  assert.notEqual(pendingStart, -1);
  const paidBranch = source.slice(paidStart, pendingStart);
  assert.match(paidBranch, /shouldRetryPaidActivation\(payment\)/);
  assert.match(paidBranch, /activateTariffByPaymentId\(paymentId\)/);
  assert.match(paidBranch, /if \(!activation\.ok\)/);
  assert.doesNotMatch(paidBranch, /balance:\s*\{\s*increment/);
});

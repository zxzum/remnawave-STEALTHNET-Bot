import assert from "node:assert/strict";
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

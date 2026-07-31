import assert from "node:assert/strict";
import test from "node:test";

import {
  crossedRemainingPercents,
  effectiveLimitBytes,
  nextMonthlyBoundary,
} from "./traffic-period.js";

test("clamps Jan 31 to leap-year February end", () => {
  assert.equal(
    nextMonthlyBoundary(new Date("2028-01-31T14:30:00.000Z")).toISOString(),
    "2028-02-29T14:30:00.000Z",
  );
});

test("clamps Jan 31 to non-leap-year February end", () => {
  assert.equal(
    nextMonthlyBoundary(new Date("2027-01-31T14:30:00.000Z")).toISOString(),
    "2027-02-28T14:30:00.000Z",
  );
});

test("preserves the UTC time at the monthly boundary", () => {
  assert.equal(
    nextMonthlyBoundary(new Date("2026-05-30T23:59:58.123Z")).toISOString(),
    "2026-06-30T23:59:58.123Z",
  );
});

test("applies grants by lifecycle", () => {
  const limit = effectiveLimitBytes(100n, [
    { bytes: 10n, scope: "CURRENT_PERIOD", tariffIdAtGrant: "t1", validPeriodStartAt: new Date("2026-07-18T00:00:00Z") },
    { bytes: 20n, scope: "WHILE_TARIFF_ACTIVE", tariffIdAtGrant: "t1", validPeriodStartAt: null },
  ], "t1", new Date("2026-07-18T00:00:00Z"));
  assert.equal(limit, 130n);
});

test("filters grants outside their matching period or tariff", () => {
  assert.equal(effectiveLimitBytes(100n, [
    { bytes: 10n, scope: "CURRENT_PERIOD", tariffIdAtGrant: "t1", validPeriodStartAt: new Date("2026-07-17T00:00:00Z") },
    { bytes: 20n, scope: "WHILE_TARIFF_ACTIVE", tariffIdAtGrant: "t2", validPeriodStartAt: null },
  ], "t1", new Date("2026-07-18T00:00:00Z")), 100n);
});

test("returns crossed remaining thresholds in notification order", () => {
  assert.deepEqual(crossedRemainingPercents(40n, 100n, 100n), [50, 25, 10, 3, 0]);
  assert.deepEqual(crossedRemainingPercents(1n, 100n, 0n), []);
});

import assert from "node:assert/strict";
import test from "node:test";

import { toPublicWhitelistQuota } from "./public-whitelist-quota.service.js";

const at = new Date("2026-08-07T10:00:00.000Z");

function quota(usedBytes: bigint, baseLimitBytes: bigint) {
  return {
    tariffIdAtPeriodStart: "tariff-1",
    baseLimitBytes,
    usedBytes,
    status: "ACTIVE",
    periodStartedAt: at,
    periodEndsAt: new Date("2026-09-07T10:00:00.000Z"),
    updatedAt: at,
    grants: [],
  };
}

test("public whitelist quota formats safe ready data", () => {
  assert.deepEqual(toPublicWhitelistQuota(quota(9_948_000_000n, 53_687_091_200n)), {
    status: "ready",
    usedBytes: 9_948_000_000,
    limitBytes: 53_687_091_200,
    remainingBytes: 43_739_091_200,
    percent: 18.53,
    asOf: "2026-08-07T10:00:00.000Z",
  });
});

test("public whitelist quota never turns invalid data into ready data", () => {
  assert.deepEqual(toPublicWhitelistQuota(quota(1n, 0n)), { status: "unavailable" });
  assert.deepEqual(toPublicWhitelistQuota(quota(101n, 100n)), { status: "unavailable" });
  assert.deepEqual(toPublicWhitelistQuota({ ...quota(1n, 100n), updatedAt: new Date("invalid") }), { status: "unavailable" });
});

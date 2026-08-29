import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const {
  buildSecondarySubscriptionConditions,
  getActiveSecondarySubscriptionStatsWhere,
} = await import("./admin.routes.js");

test("secondary subscription filters separate active paid subscriptions from admin grants and trials", () => {
  const now = new Date("2026-08-29T10:00:00.000Z");
  const paid = buildSecondarySubscriptionConditions({ paymentSource: "paid", activity: "active", now });
  const adminGrant = buildSecondarySubscriptionConditions({ paymentSource: "admin_grant", activity: "active", now });
  const trial = buildSecondarySubscriptionConditions({ paymentSource: "trial", activity: "active", now });

  assert.deepEqual(paid, [
    { trialId: null },
    {
      payments: {
        some: {
          status: "PAID",
          AND: [
            { OR: [{ tariffId: { not: null } }, { metadata: { contains: '\"customBuild\"' } }] },
            { OR: [{ provider: null }, { provider: { not: "admin_grant" } }] },
          ],
        },
      },
    },
    { expireAt: { gt: now } },
  ]);
  assert.deepEqual(adminGrant, [
    { trialId: null },
    {
      payments: {
        some: {
          status: "PAID",
          OR: [
            { provider: "admin_grant" },
            { metadata: { contains: '\"kind\":\"admin_grant\"' } },
          ],
        },
      },
    },
    { expireAt: { gt: now } },
  ]);
  assert.deepEqual(trial, [{ trialId: { not: null } }, { expireAt: { gt: now } }]);
});

test("active subscription stats use the same paid source rules", () => {
  const now = new Date("2026-08-29T10:00:00.000Z");
  const stats = getActiveSecondarySubscriptionStatsWhere(now);
  const activePaid = JSON.stringify(stats.activePaid);
  const activeAdminGrant = JSON.stringify(stats.activeAdminGrant);

  assert.match(activePaid, /"expireAt":\{"gt":"2026-08-29T10:00:00\.000Z"\}/);
  assert.match(activePaid, /"trialId":null/);
  assert.match(activePaid, /"remnawaveUuid":\{"not":null\}/);
  assert.match(activePaid, /"payments":\{"some":\{"status":"PAID"/);
  assert.match(activePaid, /"provider":\{"not":"admin_grant"\}/);
  assert.match(activeAdminGrant, /"expireAt":\{"gt":"2026-08-29T10:00:00\.000Z"\}/);
  assert.match(activeAdminGrant, /"trialId":null/);
  assert.match(activeAdminGrant, /"payments":\{"some":\{"status":"PAID"/);
  assert.match(activeAdminGrant, /"provider":"admin_grant"/);
});

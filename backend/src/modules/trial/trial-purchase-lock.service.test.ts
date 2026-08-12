import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const {
  isPaidVpnPurchase,
  isVpnSubscriptionPurchase,
  isTrialBlocked,
  selectSeparateTrialIds,
} = await import("./trial-purchase-lock.service.js");

test("only a paid VPN tariff consumes the trial", () => {
  assert.equal(isPaidVpnPurchase({ status: "PAID", tariffId: "tariff-1" }), true);
  assert.equal(isPaidVpnPurchase({ status: "PAID", provider: "admin_grant", tariffId: "tariff-1" }), false);
  assert.equal(isPaidVpnPurchase({ status: "PAID", tariffId: "tariff-1", metadata: JSON.stringify({ kind: "admin_grant" }) }), false);
  assert.equal(isPaidVpnPurchase({ status: "PAID", tariffId: null }), false);
  assert.equal(isPaidVpnPurchase({ status: "PAID", tariffId: null, proxyTariffId: "proxy-1" }), false);
  assert.equal(isPaidVpnPurchase({ status: "PAID", tariffId: null, extraOption: true }), false);
  assert.equal(isPaidVpnPurchase({ status: "PAID", tariffId: null, metadata: JSON.stringify({ extraOption: { kind: "traffic" } }) }), false);
  assert.equal(isPaidVpnPurchase({ status: "PENDING", tariffId: "tariff-1" }), false);
  assert.equal(isPaidVpnPurchase({ status: "PAID", tariffId: null, metadata: JSON.stringify({ customBuild: { days: 30 } }) }), true);
  assert.equal(isPaidVpnPurchase({ status: "PAID", tariffId: "tariff-1", metadata: JSON.stringify({ purchasedAsGift: true }) }), true);
  assert.equal(isVpnSubscriptionPurchase({ tariffId: null, metadata: JSON.stringify({ customBuild: { days: 30 }, purchasedAsGift: true }) }), true);
});

test("trial is blocked by either the permanent flag or a paid subscription", () => {
  assert.equal(isTrialBlocked(true, false), true);
  assert.equal(isTrialBlocked(false, true), true);
  assert.equal(isTrialBlocked(false, false), false);
});

test("cleanup selects every separate non-gift trial except an explicit conversion target", () => {
  assert.deepEqual(selectSeparateTrialIds([
    { id: "trial-old", trialId: "welcome", purchasedAsGift: false, deletionRequestedAt: null },
    { id: "trial-gift", trialId: "welcome", purchasedAsGift: true, deletionRequestedAt: null },
    { id: "trial-pending", trialId: "welcome", purchasedAsGift: false, deletionRequestedAt: new Date() },
    { id: "paid", trialId: null, purchasedAsGift: false, deletionRequestedAt: null },
    { id: "trial-target", trialId: "welcome", purchasedAsGift: false, deletionRequestedAt: null },
  ], "trial-target"), ["trial-old"]);
});

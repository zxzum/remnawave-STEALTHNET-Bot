import assert from "node:assert/strict";
import test from "node:test";

import { buildMergePreview, type MergeAccountSnapshot } from "./account-merge-policy.js";

const account = (owner: "primary" | "absorbed", subscriptions: MergeAccountSnapshot["subscriptions"]): MergeAccountSnapshot => ({
  id: owner,
  email: `${owner}@example.com`,
  balance: owner === "primary" ? 10 : 20,
  paymentsCount: owner === "primary" ? 1 : 2,
  subscriptions,
});

test("keeps the trial with the later expiry and does not sum trials", () => {
  const preview = buildMergePreview(
    account("primary", [{ id: "trial-a", owner: "primary", tariffId: "standard", tariffName: "Standard", trialId: "trial", trialName: "Trial", expireAt: "2026-08-10T00:00:00.000Z", tariffPrice: 100, tariffDurationDays: 30, tariffCurrency: "RUB", currentPricePerDay: null }]),
    account("absorbed", [{ id: "trial-b", owner: "absorbed", tariffId: "standard", tariffName: "Standard", trialId: "trial", trialName: "Trial", expireAt: "2026-08-12T00:00:00.000Z", tariffPrice: 100, tariffDurationDays: 30, tariffCurrency: "RUB", currentPricePerDay: null }]),
    new Date("2026-08-07T00:00:00.000Z"),
  );

  assert.equal(preview.trials.keptSubscriptionId, "trial-b");
  assert.deepEqual(preview.trials.removedSubscriptionIds, ["trial-a"]);
  assert.equal(preview.trials.summed, false);
});

test("sums remaining days for identical paid tariffs", () => {
  const preview = buildMergePreview(
    account("primary", [{ id: "sub-a", owner: "primary", tariffId: "standard", tariffName: "Standard", trialId: null, trialName: null, expireAt: "2026-08-17T00:00:00.000Z", tariffPrice: 300, tariffDurationDays: 30, tariffCurrency: "RUB", currentPricePerDay: 10 }]),
    account("absorbed", [{ id: "sub-b", owner: "absorbed", tariffId: "standard", tariffName: "Standard", trialId: null, trialName: null, expireAt: "2026-08-22T00:00:00.000Z", tariffPrice: 300, tariffDurationDays: 30, tariffCurrency: "RUB", currentPricePerDay: 10 }]),
    new Date("2026-08-07T00:00:00.000Z"),
  );

  assert.equal(preview.sameTariffs[0]?.remainingDays, 15);
  assert.equal(preview.sameTariffs[0]?.summedRemainingDays, 25);
  assert.equal(preview.sameTariffs[0]?.removedSubscriptionIds.length, 1);
});

test("offers both directions for different tariffs with pro-rata days", () => {
  const preview = buildMergePreview(
    account("primary", [{ id: "standard", owner: "primary", tariffId: "standard", tariffName: "Standard", trialId: null, trialName: null, expireAt: "2026-08-17T00:00:00.000Z", tariffPrice: 300, tariffDurationDays: 30, tariffCurrency: "RUB", currentPricePerDay: 10 }]),
    account("absorbed", [{ id: "premium", owner: "absorbed", tariffId: "premium", tariffName: "Premium", trialId: null, trialName: null, expireAt: "2026-08-22T00:00:00.000Z", tariffPrice: 600, tariffDurationDays: 30, tariffCurrency: "RUB", currentPricePerDay: 20 }]),
    new Date("2026-08-07T00:00:00.000Z"),
  );

  assert.deepEqual(preview.conversionOptions.map((item) => item.value), ["keep_both", "to_primary", "to_absorbed"]);
  assert.equal(preview.conversionOptions.find((item) => item.value === "to_primary")?.convertedDays, 30);
  assert.equal(preview.conversionOptions.find((item) => item.value === "to_absorbed")?.convertedDays, 5);
});

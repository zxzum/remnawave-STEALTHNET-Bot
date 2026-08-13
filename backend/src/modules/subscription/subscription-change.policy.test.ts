import assert from "node:assert/strict";
import test from "node:test";

const { minimumEligibleTrialBonus, quoteConvertedDays } = await import("./subscription-change.policy.js");

test("upgrade is loyal but requires one raw day", () => {
  assert.deepEqual(quoteConvertedDays({
    remainingDays: 11,
    oldPricePerDay: 10,
    newPricePerDay: 20,
    sameTariff: false,
    isTrial: false,
  }), {
    allowed: true,
    direction: "upgrade",
    convertedDays: 6,
    commissionPercent: 0,
  });

  assert.equal(quoteConvertedDays({
    remainingDays: 1,
    oldPricePerDay: 10,
    newPricePerDay: 20,
    sameTariff: false,
    isTrial: false,
  }).allowed, false);
});

test("downgrade charges five percent and floors", () => {
  assert.deepEqual(quoteConvertedDays({
    remainingDays: 30,
    oldPricePerDay: 20,
    newPricePerDay: 10,
    sameTariff: false,
    isTrial: false,
  }), {
    allowed: true,
    direction: "downgrade",
    convertedDays: 57,
    commissionPercent: 5,
  });
});

test("same tariff and trial preserve remaining whole days without commission", () => {
  assert.equal(quoteConvertedDays({
    remainingDays: 8.9,
    oldPricePerDay: 10,
    newPricePerDay: 10,
    sameTariff: true,
    isTrial: false,
  }).convertedDays, 8);

  assert.equal(quoteConvertedDays({
    remainingDays: 8,
    oldPricePerDay: null,
    newPricePerDay: 10,
    sameTariff: false,
    isTrial: true,
  }).convertedDays, 8);
});

test("first paid purchase receives minimum active trial duration exactly once", () => {
  assert.equal(minimumEligibleTrialBonus({
    activeTrialDurations: [7, 3, 14],
    trialEverUsed: false,
    subscriptionEverExisted: false,
    priorPaidPurchase: false,
  }), 3);

  assert.equal(minimumEligibleTrialBonus({
    activeTrialDurations: [3],
    trialEverUsed: true,
    subscriptionEverExisted: false,
    priorPaidPurchase: false,
  }), 0);
});

test("conversion is unavailable for expired or invalid value", () => {
  assert.deepEqual(quoteConvertedDays({
    remainingDays: 0,
    oldPricePerDay: 10,
    newPricePerDay: 20,
    sameTariff: false,
    isTrial: false,
  }), {
    allowed: false,
    direction: "none",
    convertedDays: 0,
    commissionPercent: 0,
  });

  assert.equal(quoteConvertedDays({
    remainingDays: 10,
    oldPricePerDay: null,
    newPricePerDay: 20,
    sameTariff: false,
    isTrial: false,
  }).allowed, false);
});

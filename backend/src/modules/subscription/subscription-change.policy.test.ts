import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("downgrade can round to zero days while retaining the downgrade direction", () => {
  assert.deepEqual(quoteConvertedDays({
    remainingDays: 1,
    oldPricePerDay: 10.1,
    newPricePerDay: 10,
    sameTariff: false,
    isTrial: false,
  }), {
    allowed: true,
    direction: "downgrade",
    convertedDays: 0,
    commissionPercent: 5,
  });
});

test("invalid target prices are denied even for same-tariff and trial inputs", () => {
  assert.equal(quoteConvertedDays({
    remainingDays: 8,
    oldPricePerDay: 10,
    newPricePerDay: 0,
    sameTariff: true,
    isTrial: false,
  }).allowed, false);

  assert.equal(quoteConvertedDays({
    remainingDays: 8,
    oldPricePerDay: null,
    newPricePerDay: 0,
    sameTariff: false,
    isTrial: true,
  }).allowed, false);
});

test("negative and non-positive trial durations are ignored by the bonus", () => {
  assert.equal(minimumEligibleTrialBonus({
    activeTrialDurations: [7, -3, 0, Number.NaN],
    trialEverUsed: false,
    subscriptionEverExisted: false,
    priorPaidPurchase: false,
  }), 7);
});

test("tariff conversion preview uses the shared quote policy in single mode", async () => {
  const source = await readFile(new URL("../client/client.routes.ts", import.meta.url), "utf8");
  const routeStart = source.indexOf('clientRouter.get("/tariff-conversion-preview"');
  const routeEnd = source.indexOf("clientRouter.", routeStart + 1);
  const body = source.slice(routeStart, routeEnd > routeStart ? routeEnd : undefined);

  assert.ok(routeStart >= 0);
  assert.match(source, /from "\.\.\/subscription\/subscription-change\.policy\.js"/);
  assert.match(body, /quoteConvertedDays\(/);
  assert.match(body, /sameTariff:/);
  assert.match(body, /isTrial:/);
  assert.doesNotMatch(body, /mode:\s*"replace"/);
  assert.doesNotMatch(body, /convertedDays:\s*0/);
  assert.doesNotMatch(body, /computeConvertedDays\(/);
});

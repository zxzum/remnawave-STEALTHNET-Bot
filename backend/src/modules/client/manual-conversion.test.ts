import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://localhost/lazeyka_test";
process.env.JWT_SECRET ??= "test-secret-for-manual-conversion-quote";

const {
  calculateManualConversionQuote,
  signManualConversionQuote,
  verifyManualConversionQuote,
  isManualConversionQuoteStale,
  assertRemnawaveIdentityPreserved,
} = await import("./subscription-conversion.routes.js");

const baseInput = {
  subscriptionId: "sub-1",
  clientId: "client-1",
  tariffId: "tariff-2",
  priceOptionId: "option-30",
  sourceExpireAt: "2026-08-20T00:00:00.000Z",
  sourceRevision: "2026-08-13T12:00:00.000Z",
  remainingDays: 11,
  oldPricePerDay: 10,
  newPricePerDay: 20,
  sameTariff: false,
  isTrial: false,
};

test("manual upgrade uses ceil after requiring one raw day", () => {
  const quote = calculateManualConversionQuote(baseInput);

  assert.equal(quote.rawConvertedDays, 5.5);
  assert.equal(quote.convertedDays, 6);
  assert.equal(quote.direction, "upgrade");
  assert.equal(quote.commissionPercent, 0);
  assert.equal(quote.rounding, "ceil");
});

test("manual upgrade denies less than one raw day", () => {
  const quote = calculateManualConversionQuote({
    ...baseInput,
    remainingDays: 1,
  });

  assert.equal(quote.allowed, false);
  assert.equal(quote.convertedDays, 0);
});

test("manual downgrade applies five percent before floor", () => {
  const quote = calculateManualConversionQuote({
    ...baseInput,
    oldPricePerDay: 20,
    newPricePerDay: 10,
    remainingDays: 30,
  });

  assert.equal(quote.rawConvertedDays, 60);
  assert.equal(quote.convertedDays, 57);
  assert.equal(quote.direction, "downgrade");
  assert.equal(quote.commissionPercent, 5);
  assert.equal(quote.rounding, "floor");
});

test("same tariff and trial carry whole days without commission", () => {
  const sameTariff = calculateManualConversionQuote({
    ...baseInput,
    remainingDays: 8.9,
    oldPricePerDay: 10,
    newPricePerDay: 10,
    sameTariff: true,
  });
  const trial = calculateManualConversionQuote({
    ...baseInput,
    remainingDays: 8,
    oldPricePerDay: null,
    isTrial: true,
  });

  assert.equal(sameTariff.convertedDays, 8);
  assert.equal(sameTariff.commissionPercent, 0);
  assert.equal(sameTariff.rounding, "none");
  assert.equal(trial.convertedDays, 8);
  assert.equal(trial.direction, "trial");
  assert.equal(trial.commissionPercent, 0);
});

test("manual quote token carries the source snapshot and expires in fifteen minutes", () => {
  const quote = calculateManualConversionQuote(baseInput);
  const token = signManualConversionQuote(quote);
  const verified = verifyManualConversionQuote(token);

  assert.equal(verified.subscriptionId, baseInput.subscriptionId);
  assert.equal(verified.tariffId, baseInput.tariffId);
  assert.equal(verified.priceOptionId, baseInput.priceOptionId);
  assert.equal(verified.sourceExpireAt, baseInput.sourceExpireAt);
  assert.equal(verified.sourceRevision, baseInput.sourceRevision);
  assert.equal(verified.convertedDays, 6);
  assert.equal(verified.exp - verified.iat, 15 * 60);
});

test("manual quote becomes stale when expiry or source revision changes", () => {
  const quote = calculateManualConversionQuote(baseInput);
  const sameSource = {
    expireAt: new Date(baseInput.sourceExpireAt),
    sourceRevision: baseInput.sourceRevision,
  };

  assert.equal(isManualConversionQuoteStale(quote, sameSource), false);
  assert.equal(isManualConversionQuoteStale(quote, {
    ...sameSource,
    sourceRevision: "2026-08-13T12:01:00.000Z",
  }), true);
  assert.equal(isManualConversionQuoteStale(quote, {
    ...sameSource,
    expireAt: new Date("2026-08-21T00:00:00.000Z"),
  }), true);
});

test("manual conversion preserves the exact Remnawave identity and link", () => {
  const before = {
    uuid: "remna-uuid",
    shortUuid: "short-uuid",
    subscriptionUrl: "https://sub.lazeyka.xyz/short-uuid",
  };
  const after = { ...before };

  assert.doesNotThrow(() => assertRemnawaveIdentityPreserved(before, after));
  assert.throws(() => assertRemnawaveIdentityPreserved(before, {
    ...after,
    subscriptionUrl: "https://sub.lazeyka.xyz/new-short-uuid",
  }));
});

test("manual conversion route never reissues a subscription", async () => {
  const source = await readFile(new URL("./subscription-conversion.routes.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /remnaRevokeUserSubscription/);
  assert.match(source, /withClientSubscriptionLock/);
  assert.match(source, /ManualConversionError\(409/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { canExtendSubscription, selectPrimarySubscriptionItem, shouldPreserveSubscriptionLink } from "./subscription-access.js";

test("primary access prefers index 0 even when an additional subscription appears first", () => {
  const selected = selectPrimarySubscriptionItem(
    [
      { id: "additional", subscriptionIndex: 1, remnawaveUuid: "additional-uuid" },
      { id: "primary", subscriptionIndex: 0, remnawaveUuid: "primary-uuid" },
    ],
    (item) => Boolean(item.remnawaveUuid),
  );

  assert.equal(selected?.id, "primary");
});

test("primary access keeps a first-valid fallback when index 0 is absent", () => {
  const selected = selectPrimarySubscriptionItem(
    [
      { id: "expired", subscriptionIndex: 2, remnawaveUuid: null },
      { id: "remaining", subscriptionIndex: 3, remnawaveUuid: "remaining-uuid" },
    ],
    (item) => Boolean(item.remnawaveUuid),
  );

  assert.equal(selected?.id, "remaining");
});

test("standalone trials are valid conversion targets", () => {
  assert.equal(canExtendSubscription({ tariffId: null, trialId: "trial-1" }), true);
  assert.equal(canExtendSubscription({ tariffId: null, trialId: null }), false);
});

test("trial conversion keeps the existing link even in global replace mode", () => {
  assert.equal(shouldPreserveSubscriptionLink({
    willConvert: true,
    mode: "replace",
    subscription: { isTrial: true },
  }), true);
  assert.equal(shouldPreserveSubscriptionLink({
    willConvert: true,
    mode: "convert",
    subscription: { isTrial: false },
  }), false);
  assert.equal(shouldPreserveSubscriptionLink({
    willConvert: true,
    mode: "replace",
    subscription: { isTrial: false },
  }), false);
});

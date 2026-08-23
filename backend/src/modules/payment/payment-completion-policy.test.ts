import assert from "node:assert/strict";
import test from "node:test";

import {
  decideSlotActivation,
  isSharedTopUpPayment,
} from "./payment-completion-policy.js";

test("legacy PAID slot payments without linkage refuse automatic reprovisioning", () => {
  assert.equal(decideSlotActivation({ linkedSlotCount: 0, state: null }), "LEGACY_BLOCKED");
  assert.equal(decideSlotActivation({ linkedSlotCount: 0, state: "LEGACY_BLOCKED" }), "LEGACY_BLOCKED");
});

test("new eligible payments provision once and linked slots win on every replay", () => {
  assert.equal(decideSlotActivation({ linkedSlotCount: 0, state: "ELIGIBLE" }), "PROVISION");
  assert.equal(decideSlotActivation({ linkedSlotCount: 2, state: "ELIGIBLE" }), "ALREADY_APPLIED");
  assert.equal(decideSlotActivation({ linkedSlotCount: 2, state: "LEGACY_BLOCKED" }), "ALREADY_APPLIED");
});

test("shared completion classifies every migrated provider top-up", () => {
  for (const provider of ["yoomoney_form", "cryptopay", "heleket", "lava", "lavatop"]) {
    assert.equal(isSharedTopUpPayment({
      provider,
      tariffId: null,
      proxyTariffId: null,
      singboxTariffId: null,
      hasExtraOption: false,
      isVpnProduct: false,
    }), true, provider);
  }

  assert.equal(isSharedTopUpPayment({
    provider: "lava",
    tariffId: "tariff-1",
    proxyTariffId: null,
    singboxTariffId: null,
    hasExtraOption: false,
    isVpnProduct: true,
  }), false);
});

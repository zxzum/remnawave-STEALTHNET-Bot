import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowBotWelcome } from "./onboarding-policy.js";

test("new account gets welcome", () => {
  assert.equal(shouldShowBotWelcome({ enabled: true, showOnce: true, onboardingCompleted: false, trialUsed: false }), true);
});

test("completed account skips one-time welcome", () => {
  assert.equal(shouldShowBotWelcome({ enabled: true, showOnce: true, onboardingCompleted: true, trialUsed: false }), false);
});

test("account with used trial skips welcome even when onboarding is incomplete", () => {
  assert.equal(shouldShowBotWelcome({ enabled: true, showOnce: true, onboardingCompleted: false, trialUsed: true }), false);
});

test("disabled welcome stays disabled", () => {
  assert.equal(shouldShowBotWelcome({ enabled: false, showOnce: false, onboardingCompleted: false, trialUsed: false }), false);
});

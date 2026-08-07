import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.REMNA_API_URL = "https://remna.test";
process.env.REMNA_ADMIN_TOKEN = "test-token";

const { trialAllowsTariff } = await import("./tariff-activation.service.js");

test("standalone trial conversion accepts an explicitly allowed tariff", () => {
  assert.equal(trialAllowsTariff({
    tariffId: null,
    convertEnabled: true,
    convertAllTariffs: false,
    convertTariffIds: ["paid-1"],
  }, "paid-1"), true);
  assert.equal(trialAllowsTariff({
    tariffId: null,
    convertEnabled: true,
    convertAllTariffs: false,
    convertTariffIds: ["paid-1"],
  }, "paid-2"), false);
});

test("standalone trial conversion accepts every tariff only in allow-all mode", () => {
  assert.equal(trialAllowsTariff({
    tariffId: null,
    convertEnabled: true,
    convertAllTariffs: true,
    convertTariffIds: [],
  }, "paid-2"), true);
});

test("disabled trial conversion is never eligible", () => {
  assert.equal(trialAllowsTariff({
    tariffId: "trial-tariff",
    convertEnabled: false,
    convertAllTariffs: true,
    convertTariffIds: ["paid-1"],
  }, "trial-tariff"), false);
});

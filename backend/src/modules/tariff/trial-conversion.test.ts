import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

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

test("eligible trial is selected before multi-sub category fallback", async () => {
  const source = await readFile(new URL("./tariff-activation.service.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function findConvertibleSubscription");
  const body = source.slice(start, source.indexOf("export async function", start + 1));
  const trialQuery = body.indexOf("const trialCandidates");
  const categoryGuard = body.indexOf("if (!candidate && multiSubEnabled && !perCategorySingle) return null");
  const fallbackGuard = body.indexOf("if (!candidate) {");
  assert.ok(trialQuery > 0 && trialQuery < categoryGuard);
  assert.ok(fallbackGuard > trialQuery);
});

test("trial activation has a canonical single-mode path instead of creating a second user", async () => {
  const source = await readFile(new URL("../client/client.routes.ts", import.meta.url), "utf8");
  const routeStart = source.indexOf('clientRouter.post("/trials/:id/activate"');
  const routeEnd = source.indexOf("clientRouter.", routeStart + 1);
  const body = source.slice(routeStart, routeEnd > routeStart ? routeEnd : undefined);
  assert.match(source, /resolveCanonicalSubscription/);
  assert.match(body, /multiSubscriptionsEnabled/);
  assert.match(body, /remnaUpdateUser/);
  assert.doesNotMatch(body, /createAdditionalSubscription/);
});

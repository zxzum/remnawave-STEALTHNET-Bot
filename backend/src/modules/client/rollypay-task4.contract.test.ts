import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("RollyPay defaults and public exposure require the admin flag and both secrets", async () => {
  const clientService = await readFile(new URL("./client.service.ts", import.meta.url), "utf8");
  const adminRoutes = await readFile(new URL("../admin/admin.routes.ts", import.meta.url), "utf8");
  const seed = await readFile(new URL("../../scripts/seed-system-settings.ts", import.meta.url), "utf8");

  assert.match(clientService, /rollypay_api_key.*rollypay_signing_secret.*rollypay_enabled.*rollypay_test_mode/s);
  assert.match(clientService, /rollypayEnabled: Boolean\([\s\S]*rollypayApiKey[\s\S]*rollypaySigningSecret/);
  assert.match(adminRoutes, /rollypayEnabled: z\.boolean\(\)\.optional\(\)/);
  assert.match(adminRoutes, /rollypay_enabled/);
  assert.match(seed, /\["rollypay_api_key", ""\]/);
  assert.match(seed, /\["rollypay_signing_secret", ""\]/);
  assert.match(seed, /\["rollypay_enabled", "false"\]/);
  assert.match(seed, /\["rollypay_test_mode", "false"\]/);
});

test("RollyPay purchase route uses product currency, rejects non-RUB, and returns url", async () => {
  const route = await readFile(new URL("./client.routes.ts", import.meta.url), "utf8");
  const start = route.indexOf('clientRouter.post("/rollypay/create-payment"');
  assert.ok(start >= 0);
  const end = route.indexOf('clientRouter.post("/lava/create-payment"', start);
  const body = route.slice(start, end > start ? end : undefined);

  assert.match(body, /currencyUpper\s*=\s*tariff\.currency\.toUpperCase\(\)/);
  assert.match(body, /currencyUpper\s*=\s*proxyTariff\.currency\.toUpperCase\(\)/);
  assert.match(body, /currencyUpper\s*=\s*singboxTariff\.currency\.toUpperCase\(\)/);
  assert.match(body, /currencyUpper\s*!==\s*"RUB"/);
  assert.match(body, /return res\.status\(201\)\.json\(\{[\s\S]*url[\s\S]*paymentId/);
  assert.doesNotMatch(body, /activateTariffByPaymentId/);
});

test("RollyPay raw webhook is mounted before the generic JSON parser", async () => {
  const app = await readFile(new URL("../../app.ts", import.meta.url), "utf8");
  const raw = app.indexOf('app.use("/api/webhooks/rollypay", express.raw');
  const json = app.indexOf("app.use(express.json");
  assert.ok(raw >= 0 && json >= 0 && raw < json);
});

test("RollyPay is gated in the active cabinet and bot purchase surfaces", async () => {
  const [api, tariffs, profile, services, botApi, botKeyboard, botIndex] = await Promise.all([
    readFile(new URL("../../../../frontend/src/lib/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../frontend/src/cabinet/pages/Tariffs.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../../frontend/src/cabinet/pages/Profile.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../../frontend/src/cabinet/pages/Services.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../../bot/src/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../bot/src/keyboard.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../bot/src/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(api, /rollypayCreatePayment/);
  assert.match(tariffs, /rollypayEnabled/);
  assert.match(profile, /rollypayEnabled/);
  assert.match(services, /rollypayEnabled/);
  assert.match(botApi, /createRollypayPayment/);
  assert.match(botKeyboard, /pay_tariff_rollypay/);
  assert.match(botKeyboard, /topup_rollypay/);
  assert.match(botIndex, /pay_tariff_rollypay/);
  assert.match(botIndex, /topup_rollypay/);
});

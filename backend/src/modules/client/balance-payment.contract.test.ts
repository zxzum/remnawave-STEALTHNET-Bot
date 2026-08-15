import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("main balance payment records Payment before activation and compensates failures", async () => {
  const source = await readFile(new URL("./client.routes.ts", import.meta.url), "utf8");
  const routeStart = source.indexOf('clientRouter.post("/payments/balance"');
  const mainStart = source.indexOf("const tariff = await prisma.tariff.findUnique", routeStart);
  const mainEnd = source.indexOf("// ——— Гибкий тариф", mainStart);
  const body = source.slice(mainStart, mainEnd);
  const debit = body.indexOf("const debit = await prisma.client.updateMany");
  const payment = body.indexOf("payment = await createPayment");
  const activation = body.indexOf("const activateResult = await activateTariffByPaymentId");

  assert.ok(routeStart > 0 && mainStart > routeStart && mainEnd > mainStart);
  assert.ok(debit > 0 && debit < payment && payment < activation);
  assert.match(body, /status:\s*"FAILED"/);
  assert.match(body, /balance:\s*\{\s*increment:\s*tariffPaySnap\.amount/);
});

test("balance activation delegates to the canonical payment activation path", async () => {
  const source = await readFile(new URL("./client.routes.ts", import.meta.url), "utf8");
  const routeStart = source.indexOf('clientRouter.post("/payments/balance"');
  const mainEnd = source.indexOf("// ——— Гибкий тариф", routeStart);
  const body = source.slice(routeStart, mainEnd);

  assert.match(body, /activateTariffByPaymentId\(payment\.id\)/);
  assert.doesNotMatch(body, /createAdditionalSubscription/);
  assert.doesNotMatch(body, /findConvertibleSubscription/);
  assert.doesNotMatch(body, /extendSecondarySubscription/);
  assert.doesNotMatch(body, /consolidateToSingleSubscription/);
});

test("balance activation refunds and marks the payment failed when activation throws", async () => {
  const source = await readFile(new URL("./client.routes.ts", import.meta.url), "utf8");
  const routeStart = source.indexOf('clientRouter.post("/payments/balance"');
  const mainEnd = source.indexOf("// ——— Гибкий тариф", routeStart);
  const body = source.slice(routeStart, mainEnd);
  assert.match(body, /try\s*\{\s*(?:const activateResult|activateResult)\s*=\s*await activateTariffByPaymentId\(payment\.id\)/s);
  assert.match(body, /catch\s*\(error\)[\s\S]*failBalancePayment\(500/);
});

test("balance payment persists the selected trial replacement in tariff metadata", async () => {
  const source = await readFile(new URL("./client.routes.ts", import.meta.url), "utf8");
  const routeStart = source.indexOf('clientRouter.post("/payments/balance"');
  const mainEnd = source.indexOf("// ——— Гибкий тариф", routeStart);
  const body = source.slice(routeStart, mainEnd);
  const metadata = body.indexOf("const tariffMeta: Record<string, unknown> = {};");
  const payment = body.indexOf("metadata: Object.keys(tariffMeta)", metadata);
  assert.ok(metadata >= 0 && payment > metadata);
  assert.match(body.slice(metadata, payment), /replaceTrialSubId/);
});

test("single-subscription mode defaults to disabled multi-subscriptions", async () => {
  const clientService = await readFile(new URL("./client.service.ts", import.meta.url), "utf8");
  const seed = await readFile(new URL("../../scripts/seed-system-settings.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("./client.routes.ts", import.meta.url), "utf8");
  const activation = await readFile(new URL("../tariff/tariff-activation.service.ts", import.meta.url), "utf8");

  assert.match(clientService, /multiSubscriptionsEnabled: \(map\.multi_subscriptions_enabled \?\? "false"\)/);
  assert.match(clientService, /multiSubscriptionsEnabled: full\.multiSubscriptionsEnabled \?\? false/);
  assert.match(seed, /\["multi_subscriptions_enabled", "false"\]/);
  assert.doesNotMatch(route, /multiSubscriptionsEnabled[^\n]*\?\? true/);
  assert.doesNotMatch(activation, /multiSubscriptionsEnabled[^\n]*\?\? true/);
  assert.match(activation, /multiSubEnabled: boolean = false/);
});

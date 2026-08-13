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
  const activation = body.indexOf("let activateResult");

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

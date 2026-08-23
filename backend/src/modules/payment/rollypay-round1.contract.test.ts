import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readRollypayRoute(): Promise<string> {
  const source = await readFile(new URL("../client/client.routes.ts", import.meta.url), "utf8");
  const start = source.indexOf('clientRouter.post("/rollypay/create-payment"');
  const end = source.indexOf('clientRouter.post("/lava/create-payment"', start);
  assert.ok(start >= 0, "RollyPay purchase route must exist");
  return source.slice(start, end > start ? end : undefined);
}

test("RollyPay top-ups use the centralized idempotent balance-credit classification", async () => {
  const source = await readFile(new URL("./mark-paid.service.ts", import.meta.url), "utf8");
  const classificationStart = source.indexOf("const isTopUp =");
  const classificationEnd = source.indexOf("\n\n  // Idempotent flip", classificationStart);
  assert.ok(classificationStart >= 0);
  assert.ok(classificationEnd > classificationStart);

  const classification = source.slice(classificationStart, classificationEnd);
  assert.match(classification, /payment\.provider === "rollypay"/);
  assert.match(classification, /!payment\.tariffId/);
  assert.match(classification, /!payment\.proxyTariffId/);
  assert.match(classification, /!payment\.singboxTariffId/);
  assert.match(classification, /!isExtraOption/);
  assert.match(classification, /!isVpnProduct/);

  assert.match(source, /FOR UPDATE/);
  assert.match(source, /fresh\.status !== "PENDING"/);
  assert.match(source, /tx\.payment\.update/);
  const creditStart = source.indexOf("if (isTopUp) {");
  const creditEnd = source.indexOf("return { count: 1 };", creditStart);
  assert.ok(creditEnd > creditStart);
  assert.match(source.slice(creditStart, creditEnd), /balance: \{ increment: fresh\.amount \}/);
});

test("RollyPay preserves targetSubscriptionId in every extra-option payment metadata path", async () => {
  const route = await readRollypayRoute();
  const extraStart = route.indexOf("} else if (extraOption) {");
  const productStart = route.indexOf("\n    } else {", extraStart);
  const metadataEnd = route.indexOf('if (currencyUpper !== "RUB")', extraStart);
  assert.ok(extraStart >= 0);
  assert.ok(productStart > extraStart);
  assert.ok(metadataEnd > productStart);

  const extraOptionBranch = route.slice(extraStart, metadataEnd);
  assert.match(extraOptionBranch, /kind: "traffic"/);
  assert.match(extraOptionBranch, /kind: "devices"/);
  assert.match(extraOptionBranch, /kind: "servers"/);
  assert.match(extraOptionBranch, /if \(extraOption\.targetSubscriptionId\) \{/);
  assert.match(extraOptionBranch, /metadataObj = \{ \.\.\.metadataObj, targetSubscriptionId: extraOption\.targetSubscriptionId \}/);
  assert.match(route, /const meta = \{ \.\.\.metadataObj \}/);
});

test("RollyPay records promo usage after successful mark-paid and keeps retries idempotent", async () => {
  const webhook = await readFile(new URL("../webhooks/rollypay.webhooks.routes.ts", import.meta.url), "utf8");
  const helper = await readFile(new URL("./promo-code-usage.util.ts", import.meta.url), "utf8");

  assert.match(webhook, /recordPromoCodeUsageFromPayment/);
  const markStart = webhook.indexOf("const result = await markPaymentPaid(payment.id);");
  const failureStart = webhook.indexOf("if (!result.ok)", markStart);
  const promoCall = webhook.indexOf("await recordPromoCodeUsageFromPayment(payment.id);", markStart);
  assert.ok(markStart >= 0);
  assert.ok(failureStart > markStart);
  assert.ok(promoCall > failureStart);
  assert.ok(promoCall < webhook.indexOf('return res.status(200).send("OK");', promoCall));

  assert.match(helper, /promoCodeUsage\.findFirst/);
  assert.match(helper, /if \(existing\) return;/);
  assert.match(helper, /promoCodeUsage\.create/);
});

test("RollyPay proxy and Sing-box product prices come from active DB tariffs", async () => {
  const route = await readRollypayRoute();
  const proxyStart = route.indexOf("} else if (proxyTariffIdBody) {");
  const singboxStart = route.indexOf("} else if (singboxTariffIdBody) {");
  const topUpStart = route.indexOf("\n      } else {", singboxStart);
  assert.ok(proxyStart >= 0);
  assert.ok(singboxStart > proxyStart);
  assert.ok(topUpStart > singboxStart);

  const proxyBranch = route.slice(proxyStart, singboxStart);
  const singboxBranch = route.slice(singboxStart, topUpStart);
  assert.match(proxyBranch, /prisma\.proxyTariff\.findUnique/);
  assert.match(proxyBranch, /!proxyTariff \|\| !proxyTariff\.enabled/);
  assert.match(proxyBranch, /currencyUpper = proxyTariff\.currency\.toUpperCase\(\)/);
  assert.match(proxyBranch, /amountRounded = Math\.round\(proxyTariff\.price \* 100\) \/ 100;/);
  assert.doesNotMatch(proxyBranch, /amountBody/);

  assert.match(singboxBranch, /prisma\.singboxTariff\.findUnique/);
  assert.match(singboxBranch, /!singboxTariff \|\| !singboxTariff\.enabled/);
  assert.match(singboxBranch, /currencyUpper = singboxTariff\.currency\.toUpperCase\(\)/);
  assert.match(singboxBranch, /amountRounded = Math\.round\(singboxTariff\.price \* 100\) \/ 100;/);
  assert.doesNotMatch(singboxBranch, /amountBody/);

  const topUpEnd = route.indexOf('if (currencyUpper !== "RUB")', topUpStart);
  assert.ok(topUpEnd > topUpStart);
  const topUpBranch = route.slice(topUpStart, topUpEnd);
  assert.match(topUpBranch, /if \(amountBody == null\)/);
  assert.match(topUpBranch, /amountRounded = Math\.round\(amountBody \* 100\) \/ 100/);
  assert.match(route, /if \(currencyUpper !== "RUB"\)/);
});

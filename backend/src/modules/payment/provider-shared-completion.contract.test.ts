import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directProviderFiles = [
  "../webhooks/yoomoney.webhooks.routes.ts",
  "../webhooks/cryptopay.webhooks.routes.ts",
  "../webhooks/heleket.webhooks.routes.ts",
  "../webhooks/lava.webhooks.routes.ts",
];

const allProviderFiles = [
  ...directProviderFiles,
  "../webhooks/lavatop.webhooks.routes.ts",
];

const authoritativeProviderFiles = [
  ...allProviderFiles,
  "../webhooks/yookassa.webhooks.routes.ts",
  "../webhooks/rollypay.webhooks.routes.ts",
];

test("provider routes have no manual paid, balance, tariff, proxy, or Sing-box completion bypass", async () => {
  for (const relative of allProviderFiles) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /markPaymentPaid/);
    assert.doesNotMatch(source, /activateTariffByPaymentId/);
    assert.doesNotMatch(source, /createProxySlotsByPaymentId/);
    assert.doesNotMatch(source, /createSingboxSlotsByPaymentId/);
    assert.doesNotMatch(source, /balance:\s*\{\s*increment:/);
    assert.doesNotMatch(source, /distributeReferralRewards/);
    assert.doesNotMatch(source, /extinguishOneTimeDiscount/);
  }
});

test("direct provider routes turn shared completion failures into 503 before promo usage", async () => {
  for (const relative of directProviderFiles) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    const markStart = source.indexOf("const result = await markPaymentPaid(payment.id");
    const failureStart = source.indexOf("if (!result.ok)", markStart);
    const retryStatus = source.indexOf("res.status(503)", failureStart);
    const promoUsage = source.indexOf("await recordPromoCodeUsageFromPayment(payment.id)", markStart);
    assert.ok(markStart >= 0, `${relative}: markPaymentPaid result must be captured`);
    assert.ok(failureStart > markStart, `${relative}: completion result must be checked`);
    assert.ok(retryStatus > failureStart, `${relative}: failed completion must return 503`);
    assert.ok(promoUsage > retryStatus, `${relative}: promo usage must follow successful completion`);
  }
});

test("YooMoney reconciles the signed amount exactly before shared completion", async () => {
  const source = await readFile(new URL("../webhooks/yoomoney.webhooks.routes.ts", import.meta.url), "utf8");
  const amountGuard = source.indexOf("exactFiatAmountMatches(payment.amount, amount)");
  const mismatchAck = source.indexOf('return res.status(200).send("OK")', amountGuard);
  const markStart = source.indexOf("const result = await markPaymentPaid(payment.id");
  assert.ok(amountGuard >= 0);
  assert.ok(mismatchAck > amountGuard);
  assert.ok(markStart > mismatchAck);
});

test("authoritatively verified provider routes explicitly allow FAILED payment recovery", async () => {
  for (const relative of authoritativeProviderFiles) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    const calls = source.match(/markPaymentPaid\([\s\S]*?\);/g) ?? [];
    assert.ok(calls.length > 0, `${relative}: expected shared completion call`);
    for (const call of calls) {
      assert.match(call, /allowFailedRecovery:\s*true/, `${relative}: recovery must be explicit`);
    }
  }
});

test("LavaTop propagates first-payment and recurring completion failures as 503", async () => {
  const source = await readFile(new URL("../webhooks/lavatop.webhooks.routes.ts", import.meta.url), "utf8");
  const activationHelper = source.slice(
    source.indexOf("async function activatePayment"),
    source.indexOf("async function handleRecurringRenewal"),
  );
  assert.match(activationHelper, /const result = await markPaymentPaid\(paymentId, \{ allowFailedRecovery: true \}\)/);
  assert.match(activationHelper, /return result/);

  const recurringBranch = source.slice(
    source.indexOf("subscription\\.recurring\\.payment\\.success"),
    source.indexOf("// ─── Первый платёж"),
  );
  assert.match(recurringBranch, /const result = await handleRecurringRenewal\(event\)/);
  assert.match(recurringBranch, /if \(!result\.ok\)[\s\S]*res\.status\(503\)/);

  const firstPaymentBranch = source.slice(source.indexOf("// ─── Первый платёж"));
  assert.match(firstPaymentBranch, /const result = await activatePayment\(payment\.id\)/);
  assert.match(firstPaymentBranch, /if \(!result\.ok\)[\s\S]*res\.status\(503\)/);
  assert.ok(
    firstPaymentBranch.indexOf("res.status(503)")
      < firstPaymentBranch.indexOf("await recordPromoCodeUsageFromPayment(payment.id)"),
  );
});

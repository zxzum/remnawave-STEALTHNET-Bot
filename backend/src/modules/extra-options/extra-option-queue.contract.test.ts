import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const providerFiles = [
  "../webhooks/cryptopay.webhooks.routes.ts",
  "../webhooks/heleket.webhooks.routes.ts",
  "../webhooks/lava.webhooks.routes.ts",
  "../webhooks/lavatop.webhooks.routes.ts",
  "../webhooks/yookassa.webhooks.routes.ts",
  "../webhooks/yoomoney.webhooks.routes.ts",
];

test("all paid provider gates delegate extra-option state to markPaymentPaid", async () => {
  for (const relative of providerFiles) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /markPaymentPaid/);
    assert.doesNotMatch(source, /applyExtraOptionByPaymentId/);
  }
});

test("queue uses short subscription row locks and persists PENDING before Remnawave", async () => {
  const source = await readFile(new URL("./extra-options.service.ts", import.meta.url), "utf8");
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /extraOptionState:\s*"PLANNING"/);
  assert.match(source, /extraOptionState:\s*"PENDING"/);
  assert.match(source, /extraOptionState:\s*"APPLYING"/);
  const transactionBodies = source.match(/prisma\.\$transaction\(async[\s\S]*?\n\s*\}\);/g) ?? [];
  assert.ok(transactionBodies.length >= 2);
  for (const transaction of transactionBodies) assert.doesNotMatch(transaction, /remna(?:Get|Update)User/);
  assert.ok(source.indexOf('extraOptionState: "PENDING"') < source.lastIndexOf("remnaUpdateUser("));
  assert.ok(source.indexOf('extraOptionState: "APPLYING"') < source.lastIndexOf("remnaUpdateUser("));
});

test("balance purchase is atomic and refunds only a CAS-safe pre-PENDING failure", async () => {
  const source = await readFile(new URL("../client/client.routes.ts", import.meta.url), "utf8");
  const start = source.indexOf('clientRouter.post("/payments/balance/option"');
  const end = source.indexOf("\n});", start) + 4;
  const route = source.slice(start, end);
  assert.match(route, /prisma\.\$transaction/);
  assert.match(route, /extraOptionState:\s*"NEEDS_PLAN"/);
  assert.match(route, /canRefundExtraOptionFailure/);
  assert.match(route, /cancelExtraOptionPaymentBeforePending/);
  assert.doesNotMatch(route, /status:\s*"PAID"[\s\S]*applyExtraOptionByPaymentId[\s\S]*balance:\s*\{ increment/);
});

test("maintenance drains durable paid extra-option states", async () => {
  const source = await readFile(new URL("../subscription/subscription-maintenance.cron.ts", import.meta.url), "utf8");
  assert.match(source, /drainPaidExtraOptionQueue/);
  assert.match(source, /extraOptions:\s*await guarded\("extraOptions", \(\) => extraOptions/);
});

test("LavaTop keeps auth, webhook amount, and recurring renewal semantics", async () => {
  const source = await readFile(new URL("../webhooks/lavatop.webhooks.routes.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("verifyLavatopWebhookAuth") < source.indexOf("parseLavatopWebhook(body"));
  const recurring = source.slice(source.indexOf("async function handleRecurringRenewal"), source.indexOf("/** POST /api/webhooks/lavatop"));
  assert.match(recurring, /const amount = event\.amount \?\? 0/);
  assert.match(recurring, /delete metadata\.subscriptionActivated/);
  assert.match(recurring, /delete metadata\.subscriptionId/);
  assert.match(recurring, /subscriptionId:\s*parent\.subscriptionId/);
  assert.match(recurring, /status:\s*"PENDING"/);
  assert.match(recurring, /return activatePayment\(newPaymentId\)/);
});

test("every direct extra-option caller notifies only for a fresh APPLIED outcome", async () => {
  const callerFiles = [
    "../payment/mark-paid.service.ts",
    "../webhooks/platega.webhooks.routes.ts",
    "../webhooks/overpay.webhooks.routes.ts",
    "../payment-actions/payment-actions.routes.ts",
    "../client/client.routes.ts",
    "./extra-options.service.ts",
  ];
  for (const relative of callerFiles) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    const notificationCalls = source.match(/(?:await\s+)?notifyExtraOptionApplied\s*\(/g) ?? [];
    const strictGuards = source.match(/outcome\s*===\s*"APPLIED"/g) ?? [];
    assert.ok(notificationCalls.length > 0, `${relative}: expected an extra-option notification call`);
    assert.ok(strictGuards.length >= notificationCalls.length, `${relative}: every notification must have an APPLIED outcome guard`);
  }
});

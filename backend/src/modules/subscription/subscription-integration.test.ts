import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("whole subscription flow keeps the canonical identity through reissue", async () => {
  const [tariff, markPaid, conversion, admin, autoRenew, rotation, rotationTests] = await Promise.all([
    read("../tariff/tariff-activation.service.ts"),
    read("../payment/mark-paid.service.ts"),
    read("../client/subscription-conversion.routes.ts"),
    read("../admin/admin.routes.ts"),
    read("../payment/auto-renew.cron.ts"),
    read("./subscription-link-rotation.service.ts"),
    read("./subscription-link-rotation.service.test.ts"),
  ]);

  const flow = [
    ["trial → paid", `${tariff}\n${markPaid}`, /isTrialConversion = sec\.trialId != null[\s\S]*activateTariffByPaymentId\(paymentId\)/],
    ["paid", tariff, /export async function activateTariffByPaymentId[\s\S]*withClientSubscriptionLock/],
    ["conversion", conversion, /withClientSubscriptionLock[\s\S]*beforeIdentity[\s\S]*assertRemnawaveIdentityPreserved/],
    ["renewal", tariff, /const baseDate = !effectiveConvert[\s\S]*const totalDays/],
    ["admin", admin, /extendSecondarySubscription\([\s\S]*true, \/\/ convertMode/],
    ["auto-renew", autoRenew, /const payment = await prisma\.payment\.create[\s\S]*activateTariffByPaymentId\(payment\.id\)/],
    ["reissue", rotation, /beforeInvariants[\s\S]*remnawaveShortUuid: shortUuid, linkRotatedAt: now/],
  ] as const;

  for (const [stage, source, pattern] of flow) assert.match(source, pattern, `${stage} stage is not wired`);

  assert.match(conversion, /remnawaveUuid: beforeIdentity\.uuid/);
  assert.match(conversion, /remnawaveShortUuid: beforeIdentity\.shortUuid/);
  assert.doesNotMatch(rotation, /data:\s*\{[^}]*remnawaveUuid/s);
  assert.match(rotation, /\b429,[\s\S]*COOLDOWN_MS/);
  assert.match(rotationTests, /assert\.equal\(result\.status, 429\)/);
});

test("webhook, balance, retry, gift race, and multi-subscription paths keep one winner", async () => {
  const [markPaid, activation, balance, autoRenew, gift, clientService, seed] = await Promise.all([
    read("../payment/mark-paid.service.ts"),
    read("../tariff/tariff-activation.service.ts"),
    read("../client/client.routes.ts"),
    read("../payment/auto-renew.cron.ts"),
    read("../gift/gift.service.ts"),
    read("../client/client.service.ts"),
    read("../../scripts/seed-system-settings.ts"),
  ]);

  assert.match(activation, /withClientSubscriptionLock\(payment\.clientId/);

  const balanceRoute = balance.slice(balance.indexOf('clientRouter.post("/payments/balance"'));
  assert.match(balanceRoute, /activateTariffByPaymentId\(payment\.id\)/);
  assert.match(balanceRoute, /failBalancePayment/);
  assert.match(autoRenew, /recentYkPayment[\s\S]*retryResult = await activateTariffByPaymentId/);

  assert.match(gift, /giftCode\.updateMany\([\s\S]*status: "ACTIVE"[\s\S]*status: "REDEEMED"/);
  assert.match(gift, /claim\.count === 0/);

  assert.match(clientService, /multi_subscriptions_enabled/);
  assert.match(seed, /\["multi_subscriptions_enabled", "false"\]/);
  assert.match(autoRenew, /const multiSubscriptionsEnabled = config\.multiSubscriptionsEnabled \?\? true/);
  assert.match(autoRenew, /multiSubscriptionsEnabled \? \{\} : \{ subscriptionIndex: 0 \}/);
});

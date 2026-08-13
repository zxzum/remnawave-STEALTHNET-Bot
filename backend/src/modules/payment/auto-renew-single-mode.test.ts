import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./auto-renew.cron.ts", import.meta.url), "utf8");
const legacyStart = source.indexOf("const clients = await prisma.client.findMany");
const canonicalQueryStart = source.indexOf("const secondaries = await prisma.subscription.findMany");
const canonicalLoopStart = source.indexOf("for (const sec of secondaries)", canonicalQueryStart);
const canonicalEnd = source.lastIndexOf("\n}");
const legacy = source.slice(legacyStart, canonicalQueryStart);
const canonicalQuery = source.slice(canonicalQueryStart, canonicalLoopStart);
const canonicalLoop = source.slice(canonicalLoopStart, canonicalEnd);

test("canonical primary subscription owns renewal when legacy Client fields are also populated", () => {
  assert.match(legacy, /ownerId_subscriptionIndex/);
  assert.match(legacy, /select:\s*\{\s*id:\s*true/);
  assert.match(legacy, /if \(primarySubscription\)/);
  assert.match(legacy, /autoRenewEnabled:\s*true/);
  assert.match(legacy, /await processSecondaryAutoRenewals\(multiSubscriptionsEnabled\)/);
});

test("single mode selects only Subscription[0] and respects each subscription toggle", () => {
  assert.match(source, /const multiSubscriptionsEnabled = config\.multiSubscriptionsEnabled \?\? true/);
  assert.match(canonicalQuery, /autoRenewEnabled:\s*true/);
  assert.match(canonicalQuery, /\.\.\.\(multiSubscriptionsEnabled \? \{\} : \{ subscriptionIndex: 0 \}\)/);
});

test("multi mode keeps the existing individual-subscription renewal path", () => {
  assert.match(canonicalLoop, /for \(const sec of secondaries\)/);
  assert.match(canonicalLoop, /extendsSecondarySubId: sec\.id/);
  assert.match(canonicalLoop, /activateTariffByPaymentId\(payment\.id\)/);
  assert.doesNotMatch(canonicalLoop, /extendSecondarySubscription\(/);
});

test("each new renewal creates one Payment and one activation, while retry does not charge again", () => {
  assert.equal((canonicalLoop.match(/prisma\.payment\.create\(/g) ?? []).length, 1);
  assert.equal((canonicalLoop.match(/activateTariffByPaymentId\(payment\.id\)/g) ?? []).length, 1);
  assert.match(canonicalLoop, /recentYkPayment/);
  assert.match(canonicalLoop, /recentYkPayment\.subscriptionId === sec\.id/);
  assert.match(canonicalLoop, /activateTariffByPaymentId\(recentYkPayment\.id\)/);
});

test("activation failure compensates balance and marks a balance payment failed", () => {
  assert.match(canonicalLoop, /balance:\s*\{ increment: paidViaBalance \}/);
  assert.match(canonicalLoop, /status: \"FAILED\"/);
});

test("auto-renew source never mutates canonical Remnawave identity or subscription URL", () => {
  const runtime = source.slice(source.indexOf("export async function processAutoRenewals"));
  assert.doesNotMatch(runtime, /remnawaveUuid:\s*null/);
  assert.doesNotMatch(runtime, /remnawaveUsername:/);
  assert.doesNotMatch(runtime, /subscriptionUrl/);
});

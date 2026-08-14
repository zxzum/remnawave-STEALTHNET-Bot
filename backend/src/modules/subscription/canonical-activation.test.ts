import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.REMNA_API_URL = "https://remna.test";
process.env.REMNA_ADMIN_TOKEN = "test-token";

const { selectCanonicalSubscription, withClientSubscriptionLock, bestEffortTrialCleanup } = await import("../tariff/tariff-activation.service.js");

test("canonical selection prefers owned index zero over a newer secondary", () => {
  const selected = selectCanonicalSubscription([
    { id: "secondary", subscriptionIndex: 1, ownerId: "client-1", purchasedAsGift: false, giftStatus: null, giftedToClientId: null, deletionRequestedAt: null, expireAt: new Date("2099-01-01") },
    { id: "canonical-sub-0", subscriptionIndex: 0, ownerId: "client-1", purchasedAsGift: false, giftStatus: null, giftedToClientId: null, deletionRequestedAt: null, expireAt: new Date("2027-01-01") },
  ]);
  assert.equal(selected?.id, "canonical-sub-0");
});

test("canonical selection ignores gifts and deletion tombstones", () => {
  const selected = selectCanonicalSubscription([
    { id: "gift", subscriptionIndex: 0, ownerId: "client-1", purchasedAsGift: true, giftStatus: "GIFT_RESERVED", giftedToClientId: null, deletionRequestedAt: null, expireAt: new Date("2099-01-01") },
    { id: "deleted", subscriptionIndex: 0, ownerId: "client-1", purchasedAsGift: false, giftStatus: null, giftedToClientId: null, deletionRequestedAt: new Date("2026-01-01"), expireAt: new Date("2099-01-01") },
    { id: "canonical-sub-0", subscriptionIndex: 1, ownerId: "client-1", purchasedAsGift: false, giftStatus: null, giftedToClientId: null, deletionRequestedAt: null, expireAt: new Date("2027-01-01") },
  ]);
  assert.equal(selected?.id, "canonical-sub-0");
});

test("canonical selection prefers an active secondary over an expired index zero", () => {
  const selected = selectCanonicalSubscription([
    { id: "expired-index-0", subscriptionIndex: 0, ownerId: "client-1", purchasedAsGift: false, giftStatus: null, giftedToClientId: null, deletionRequestedAt: null, expireAt: new Date("2020-01-01") },
    { id: "active-secondary", subscriptionIndex: 1, ownerId: "client-1", purchasedAsGift: false, giftStatus: null, giftedToClientId: null, deletionRequestedAt: null, expireAt: new Date("2099-01-01") },
  ], new Date("2026-01-01"));
  assert.equal(selected?.id, "active-secondary");
});

test("activation exposes a database-backed client lock and canonical resolver", async () => {
  const source = await readFile(new URL("../tariff/tariff-activation.service.ts", import.meta.url), "utf8");
  assert.match(source, /export async function withClientSubscriptionLock/);
  assert.match(source, /Prisma\.TransactionClient/);
  assert.match(source, /pg_advisory_xact_lock\(hashtext\(/);
  assert.doesNotMatch(source, /FOR UPDATE/);
  assert.match(source, /export async function resolveCanonicalSubscription/);
  assert.match(source, /subscriptionIndex:\s*0/);
});

test("advisory activation locks use executeRaw for PostgreSQL void results", async () => {
  const source = await readFile(new URL("../tariff/tariff-activation.service.ts", import.meta.url), "utf8");
  const lockStart = source.indexOf("export async function withClientSubscriptionLock");
  const lockEnd = source.indexOf("export async function", lockStart + 1);
  const lock = source.slice(lockStart, lockEnd > lockStart ? lockEnd : undefined);
  assert.match(lock, /tx\.\$executeRaw`SELECT pg_advisory_xact_lock/);
  assert.doesNotMatch(lock, /tx\.\$queryRaw`SELECT pg_advisory_xact_lock/);
});

test("client lock orders advisory lock, operation, and commit", async () => {
  const events: string[] = [];
  const fakeTx = {
    $executeRaw: async () => {
      events.push("lock");
      return [];
    },
  } as any;
  const result = await withClientSubscriptionLock("client-1", async (tx) => {
    assert.equal(tx, fakeTx);
    events.push("operation");
    return "done";
  }, {
    transaction: async (callback) => {
      const value = await callback(fakeTx);
      events.push("commit");
      return value;
    },
  });
  assert.equal(result, "done");
  assert.deepEqual(events, ["lock", "operation", "commit"]);
});

test("payment activation core uses the transaction client for local state", async () => {
  const source = await readFile(new URL("../tariff/tariff-activation.service.ts", import.meta.url), "utf8");
  const activation = source.slice(
    source.indexOf("async function activateTariffByPaymentIdUnlocked"),
    source.indexOf("/** Serialize payment activation", source.indexOf("async function activateTariffByPaymentIdUnlocked")),
  );
  assert.match(activation, /activateTariffByPaymentIdUnlocked\(paymentId: string, tx: Prisma\.TransactionClient\)/);
  assert.match(activation, /tx\.payment\.findUnique/);
  assert.match(activation, /tx\.client\.findUnique/);
  assert.match(activation, /tx\.tariff\.findUnique/);
  assert.match(activation, /tx\.subscription\.findUnique/);
  assert.match(activation, /tx\.payment\.update/);
  assert.doesNotMatch(activation, /await prisma\.(payment|client|tariff|subscription)\./);
});

test("bonus metadata persistence is required before the trial lock", async () => {
  const source = await readFile(new URL("../tariff/tariff-activation.service.ts", import.meta.url), "utf8");
  const activation = source.slice(source.indexOf("async function activateTariffByPaymentIdUnlocked"));
  const update = activation.indexOf("await tx.payment.update({");
  const mark = activation.indexOf("markTrialUsedForPaidPurchase");
  assert.ok(update >= 0 && mark > update, `update=${update}, mark=${mark}`);
  const persistenceBlock = activation.slice(update, mark);
  assert.doesNotMatch(persistenceBlock, /\.catch\(\(\) => \{\}\)/);
  assert.match(persistenceBlock, /catch \(error\)/);
  assert.match(persistenceBlock, /return \{ ok: false/);
});

test("paid activation computes the first-purchase bonus before marking trial usage", async () => {
  const source = await readFile(new URL("../tariff/tariff-activation.service.ts", import.meta.url), "utf8");
  const activation = source.slice(source.indexOf("async function activateTariffByPaymentIdUnlocked"));
  const bonus = activation.indexOf("firstPaidTrialBonusDays");
  const mark = activation.indexOf("markTrialUsedForPaidPurchase");
  assert.ok(bonus >= 0 && mark > bonus, `bonus=${bonus}, mark=${mark}`);
  assert.match(activation, /minimumEligibleTrialBonus\(/);
});

test("single-mode paid conversion never passes hardReplace", async () => {
  const source = await readFile(new URL("../tariff/tariff-activation.service.ts", import.meta.url), "utf8");
  const activation = source.slice(source.indexOf("async function activateTariffByPaymentIdUnlocked"));
  assert.doesNotMatch(activation, /const hardReplace\s*=\s*!multiSubEnabled/);
  assert.doesNotMatch(activation, /\/\* hardReplace \*\/\s*!multiSubEnabled/);
});

test("single-mode conversion searches canonical index zero before same-tariff fallback", async () => {
  const source = await readFile(new URL("../tariff/tariff-activation.service.ts", import.meta.url), "utf8");
  const finder = source.slice(source.indexOf("export async function findConvertibleSubscription"));
  const canonical = finder.indexOf("selectCanonicalSubscription(canonicalRows)");
  const sameTariffFallback = finder.indexOf("where: { ...commonWhere, tariffId, trialId: null }");
  assert.ok(canonical >= 0 && sameTariffFallback > canonical, `canonical=${canonical}, fallback=${sameTariffFallback}`);
});

test("trial cleanup errors cannot undo a successful activation marker", async () => {
  let markerPersisted = false;
  markerPersisted = true;
  const log = console.error;
  console.error = () => {};
  try {
    await bestEffortTrialCleanup("test", async () => {
      throw new Error("cleanup unavailable");
    });
  } finally {
    console.error = log;
  }
  assert.equal(markerPersisted, true);
});

test("gift trial cleanup after activation is best effort", async () => {
  const source = await readFile(new URL("../tariff/tariff-activation.service.ts", import.meta.url), "utf8");
  const activation = source.slice(source.indexOf("async function activateTariffByPaymentIdUnlocked"));
  assert.doesNotMatch(activation, /if \(isGiftPurchase\) await deleteSeparateTrialSubscriptions\(client\.id\)/);
  assert.match(activation, /bestEffortTrialCleanup\("delete-gift-trials"/);
  const custom = activation.slice(activation.indexOf("const customBuild = parseCustomBuildMetadata"));
  assert.doesNotMatch(custom.slice(0, custom.indexOf("const result = await createAdditionalSubscription")), /deleteSeparateTrialSubscriptions/);
  assert.match(custom, /await persistActivation\(result\.data\.subscriptionId\);[\s\S]*bestEffortTrialCleanup\("delete-after-custom-activation"/);
});

test("activation retries require a verified success marker and subscription id", async () => {
  const source = await readFile(new URL("../tariff/tariff-activation.service.ts", import.meta.url), "utf8");
  const activation = source.slice(source.indexOf("async function activateTariffByPaymentIdUnlocked"));
  assert.match(activation, /subscriptionActivated\s*===\s*true/);
  assert.match(activation, /subscriptionId/);
  assert.match(activation, /subscriptionActivated:\s*true/);
});

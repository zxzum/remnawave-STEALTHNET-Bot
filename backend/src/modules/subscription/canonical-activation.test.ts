import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.REMNA_API_URL = "https://remna.test";
process.env.REMNA_ADMIN_TOKEN = "test-token";

const { selectCanonicalSubscription, withClientSubscriptionLock } = await import("../tariff/tariff-activation.service.js");

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

test("activation exposes a database-backed client lock and canonical resolver", async () => {
  const source = await readFile(new URL("../tariff/tariff-activation.service.ts", import.meta.url), "utf8");
  assert.match(source, /export async function withClientSubscriptionLock/);
  assert.match(source, /Prisma\.TransactionClient/);
  assert.match(source, /pg_advisory_xact_lock\(hashtext\(/);
  assert.doesNotMatch(source, /FOR UPDATE/);
  assert.match(source, /export async function resolveCanonicalSubscription/);
  assert.match(source, /subscriptionIndex:\s*0/);
});

test("client lock orders advisory lock, operation, and commit", async () => {
  const events: string[] = [];
  const fakeTx = {
    $queryRaw: async () => {
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

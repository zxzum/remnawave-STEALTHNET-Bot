import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = await readFile(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const adminRoutes = await readFile(new URL("../admin/admin.routes.ts", import.meta.url), "utf8");

test("Prisma schema хранит sync-состояние Subscription без legacy public token", () => {
  assert.doesNotMatch(schema, /publicSubscriptionToken|public_subscription_token/);
  assert.match(schema, /syncStatus\s+SubscriptionSyncStatus/);
  assert.match(schema, /deletionRequestedAt\s+DateTime\?/);
  assert.match(schema, /deletionOperation\s+SubscriptionDeletionOperation\?/);
  assert.match(schema, /enum SubscriptionDeletionOperation/);
  assert.match(schema, /enum SubscriptionSyncStatus/);
});

test("Prisma schema больше не содержит composite models", () => {
  assert.doesNotMatch(schema, /RemnawaveComponent|remnawave_components/);
  assert.match(schema, /model Subscription/);
  assert.match(schema, /model SquadTrafficQuota/);
});

test("Prisma schema хранит ограниченную локальную quota-модель squad", () => {
  assert.match(schema, /enum TrafficLimitMode[\s\S]*REMNAWAVE[\s\S]*LOCAL_SQUAD/);
  assert.match(schema, /model SquadTrafficQuota[\s\S]*subscriptionId[\s\S]*@unique/);
  assert.doesNotMatch(schema, /model TrafficUsageSample/);
});

test("Prisma schema хранит bounded checkpoint и singleton worker state трафика", async () => {
  const migration = await readFile(new URL("../../../prisma/migrations/20260719020000_squad_traffic_checkpoint/migration.sql", import.meta.url), "utf8");

  assert.match(schema, /model TrafficUsageCheckpoint[\s\S]*subscriptionId[\s\S]*@unique/);
  assert.match(schema, /currentDate[\s\S]*previousDate/);
  assert.match(schema, /model TrafficAccountingWorkerState/);
  assert.doesNotMatch(schema, /TrafficUsageSample/);
  assert.match(migration, /CREATE TABLE "traffic_usage_checkpoints"/);
  assert.match(migration, /CREATE TABLE "traffic_accounting_worker_state"/);
  assert.doesNotMatch(migration, /^\s*(?:INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM)\b|TrafficUsageSample/im);
});

test("extra-option queue schema is additive and enforces one uncertain payment per subscription", async () => {
  const migration = await readFile(new URL("../../../prisma/migrations/20260718180000_extra_option_application_queue/migration.sql", import.meta.url), "utf8");
  assert.match(schema, /enum ExtraOptionApplicationState\s*\{[\s\S]*NEEDS_PLAN[\s\S]*PLANNING[\s\S]*PENDING[\s\S]*APPLYING[\s\S]*MANUAL_REVIEW[\s\S]*APPLIED[\s\S]*FAILED_SAFE[\s\S]*\}/);
  assert.match(schema, /extraOptionState\s+ExtraOptionApplicationState\?/);
  assert.match(schema, /extraOptionClaimToken\s+String\?/);
  assert.match(schema, /extraOptionNextAttemptAt\s+DateTime\?/);
  assert.match(migration, /CREATE TYPE "ExtraOptionApplicationState"/);
  assert.equal((migration.match(/ADD COLUMN/g) ?? []).length, 3);
  assert.match(migration, /CREATE UNIQUE INDEX "payments_one_uncertain_extra_option_per_subscription"[\s\S]*WHERE "extra_option_state" IN \('PLANNING', 'PENDING', 'APPLYING', 'MANUAL_REVIEW'\)/);
  assert.doesNotMatch(migration, /\bUPDATE\b|remnawave_components|tariff_remnawave_components|trial_remnawave_components/i);
});

test("список категорий тарифов не загружает legacy Remnawave-компоненты", () => {
  const categoryRoute = adminRoutes.slice(
    adminRoutes.indexOf('adminRouter.get("/tariff-categories"'),
    adminRoutes.indexOf("const createTariffCategorySchema"),
  );
  assert.doesNotMatch(categoryRoute, /remnawaveComponents/);
  assert.doesNotMatch(adminRoutes, /remnawaveComponentInputSchema|remnawaveComponentsSchema/);
  assert.doesNotMatch(adminRoutes, /(tariff|trial)RemnawaveComponent\.(createMany|deleteMany)/);
});

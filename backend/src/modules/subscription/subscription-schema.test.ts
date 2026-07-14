import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = await readFile(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const adminRoutes = await readFile(new URL("../admin/admin.routes.ts", import.meta.url), "utf8");

test("Prisma schema хранит публичный токен и sync-состояние Subscription", () => {
  assert.match(schema, /publicSubscriptionToken\s+String\s+@unique/);
  assert.match(schema, /syncStatus\s+SubscriptionSyncStatus/);
  assert.match(schema, /deletionRequestedAt\s+DateTime\?/);
  assert.match(schema, /enum SubscriptionSyncStatus/);
});

test("Prisma schema описывает универсальные runtime-компоненты", () => {
  assert.match(schema, /model RemnawaveComponent/);
  assert.match(schema, /@@unique\(\[subscriptionId, key\]\)/);
  assert.match(schema, /internalSquadUuids\s+String\[\]/);
  assert.match(schema, /showQuotaToClient\s+Boolean/);
});

test("Prisma schema описывает шаблоны компонентов тарифов и standalone trial", () => {
  assert.match(schema, /model TariffRemnawaveComponent/);
  assert.match(schema, /model TrialRemnawaveComponent/);
});

test("список категорий тарифов загружает Remnawave-компоненты", () => {
  const categoryRoute = adminRoutes.slice(
    adminRoutes.indexOf('adminRouter.get("/tariff-categories"'),
    adminRoutes.indexOf("const createTariffCategorySchema"),
  );
  assert.match(categoryRoute, /remnawaveComponents:\s*\{\s*orderBy:\s*\{\s*mergeOrder:\s*"asc"/);
});

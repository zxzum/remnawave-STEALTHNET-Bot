-- Универсальные N Remnawave Components для одной логической Subscription.
-- Миграция выполняет только локальный backfill; сетевых запросов в Remnawave нет.

CREATE TYPE "SubscriptionSyncStatus" AS ENUM ('SYNCED', 'PENDING', 'ERROR');

ALTER TABLE "subscriptions"
  ADD COLUMN "public_subscription_token" TEXT,
  ADD COLUMN "sync_status" "SubscriptionSyncStatus" NOT NULL DEFAULT 'SYNCED',
  ADD COLUMN "sync_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sync_error" TEXT,
  ADD COLUMN "sync_required_at" TIMESTAMP(3),
  ADD COLUMN "last_reconciled_at" TIMESTAMP(3),
  ADD COLUMN "grace_until" TIMESTAMP(3),
  ADD COLUMN "deletion_requested_at" TIMESTAMP(3);

-- Не зависит от UUID-функций/extensions и безопасно для существующей production DB.
UPDATE "subscriptions"
SET "public_subscription_token" =
  MD5("id" || CLOCK_TIMESTAMP()::TEXT || RANDOM()::TEXT) ||
  MD5(RANDOM()::TEXT || "owner_id" || "id")
WHERE "public_subscription_token" IS NULL;

ALTER TABLE "subscriptions"
  ALTER COLUMN "public_subscription_token" SET NOT NULL;

CREATE UNIQUE INDEX "subscriptions_public_subscription_token_key"
  ON "subscriptions"("public_subscription_token");
CREATE INDEX "subscriptions_sync_status_sync_required_at_idx"
  ON "subscriptions"("sync_status", "sync_required_at");
CREATE INDEX "subscriptions_last_reconciled_at_idx"
  ON "subscriptions"("last_reconciled_at");
CREATE INDEX "subscriptions_deletion_requested_at_idx"
  ON "subscriptions"("deletion_requested_at");

CREATE TABLE "remnawave_components" (
  "id" TEXT NOT NULL,
  "subscription_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "admin_name" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT FALSE,
  "merge_order" INTEGER NOT NULL DEFAULT 0,
  "remnawave_uuid" TEXT,
  "upstream_short_uuid" TEXT,
  "internal_squad_uuids" TEXT[] NOT NULL,
  "traffic_limit_bytes" BIGINT,
  "traffic_reset_mode" TEXT NOT NULL DEFAULT 'no_reset',
  "show_quota_to_client" BOOLEAN NOT NULL DEFAULT FALSE,
  "quota_display_name" TEXT,
  "last_known_status" TEXT,
  "last_sync_error" TEXT,
  "last_synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "remnawave_components_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tariff_remnawave_components" (
  "id" TEXT NOT NULL,
  "tariff_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "admin_name" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT FALSE,
  "merge_order" INTEGER NOT NULL DEFAULT 0,
  "internal_squad_uuids" TEXT[] NOT NULL,
  "traffic_limit_bytes" BIGINT,
  "traffic_reset_mode" TEXT NOT NULL DEFAULT 'no_reset',
  "show_quota_to_client" BOOLEAN NOT NULL DEFAULT FALSE,
  "quota_display_name" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tariff_remnawave_components_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trial_remnawave_components" (
  "id" TEXT NOT NULL,
  "trial_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "admin_name" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT FALSE,
  "merge_order" INTEGER NOT NULL DEFAULT 0,
  "internal_squad_uuids" TEXT[] NOT NULL,
  "traffic_limit_bytes" BIGINT,
  "traffic_reset_mode" TEXT NOT NULL DEFAULT 'no_reset',
  "show_quota_to_client" BOOLEAN NOT NULL DEFAULT FALSE,
  "quota_display_name" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trial_remnawave_components_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "remnawave_components_remnawave_uuid_key"
  ON "remnawave_components"("remnawave_uuid");
CREATE UNIQUE INDEX "remnawave_components_subscription_id_key_key"
  ON "remnawave_components"("subscription_id", "key");
CREATE UNIQUE INDEX "remnawave_components_subscription_id_merge_order_key"
  ON "remnawave_components"("subscription_id", "merge_order");
CREATE INDEX "remnawave_components_subscription_id_idx"
  ON "remnawave_components"("subscription_id");

CREATE UNIQUE INDEX "tariff_remnawave_components_tariff_id_key_key"
  ON "tariff_remnawave_components"("tariff_id", "key");
CREATE UNIQUE INDEX "tariff_remnawave_components_tariff_id_merge_order_key"
  ON "tariff_remnawave_components"("tariff_id", "merge_order");
CREATE INDEX "tariff_remnawave_components_tariff_id_idx"
  ON "tariff_remnawave_components"("tariff_id");

CREATE UNIQUE INDEX "trial_remnawave_components_trial_id_key_key"
  ON "trial_remnawave_components"("trial_id", "key");
CREATE UNIQUE INDEX "trial_remnawave_components_trial_id_merge_order_key"
  ON "trial_remnawave_components"("trial_id", "merge_order");
CREATE INDEX "trial_remnawave_components_trial_id_idx"
  ON "trial_remnawave_components"("trial_id");

-- На уровне БД запрещаем более одного обязательного компонента. Наличие ровно
-- одного проверяется application validation, потому что partial CHECK не может
-- охватить отсутствие строк в дочерней таблице.
CREATE UNIQUE INDEX "remnawave_components_one_required_idx"
  ON "remnawave_components"("subscription_id") WHERE "required" = TRUE;
CREATE UNIQUE INDEX "tariff_remnawave_components_one_required_idx"
  ON "tariff_remnawave_components"("tariff_id") WHERE "required" = TRUE AND "enabled" = TRUE;
CREATE UNIQUE INDEX "trial_remnawave_components_one_required_idx"
  ON "trial_remnawave_components"("trial_id") WHERE "required" = TRUE AND "enabled" = TRUE;

ALTER TABLE "remnawave_components"
  ADD CONSTRAINT "remnawave_components_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tariff_remnawave_components"
  ADD CONSTRAINT "tariff_remnawave_components_tariff_id_fkey"
  FOREIGN KEY ("tariff_id") REFERENCES "tariffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trial_remnawave_components"
  ADD CONSTRAINT "trial_remnawave_components_trial_id_fkey"
  FOREIGN KEY ("trial_id") REFERENCES "trials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Legacy Main становится обычным обязательным компонентом.
INSERT INTO "remnawave_components" (
  "id", "subscription_id", "key", "admin_name", "required", "merge_order",
  "remnawave_uuid", "internal_squad_uuids", "traffic_limit_bytes",
  "traffic_reset_mode", "show_quota_to_client", "created_at", "updated_at"
)
SELECT
  ('rcmp' || SUBSTRING(MD5(s."id"), 1, 21))::TEXT,
  s."id",
  'primary',
  'Основной',
  TRUE,
  0,
  s."remnawave_uuid",
  COALESCE(t."internal_squad_uuids", ARRAY[]::TEXT[]),
  t."traffic_limit_bytes",
  COALESCE(t."traffic_reset_mode", 'no_reset'),
  FALSE,
  NOW(),
  NOW()
FROM "subscriptions" s
LEFT JOIN "tariffs" t ON t."id" = s."tariff_id"
WHERE s."remnawave_uuid" IS NOT NULL
ON CONFLICT ("subscription_id", "key") DO NOTHING;

-- Существующие поля тарифа становятся обязательным template без изменения
-- текущего admin/API-контракта.
INSERT INTO "tariff_remnawave_components" (
  "id", "tariff_id", "key", "admin_name", "required", "merge_order",
  "internal_squad_uuids", "traffic_limit_bytes", "traffic_reset_mode",
  "show_quota_to_client", "enabled", "created_at", "updated_at"
)
SELECT
  ('tcmp' || SUBSTRING(MD5(t."id"), 1, 21))::TEXT,
  t."id",
  'primary',
  'Основной',
  TRUE,
  0,
  t."internal_squad_uuids",
  t."traffic_limit_bytes",
  t."traffic_reset_mode",
  FALSE,
  TRUE,
  NOW(),
  NOW()
FROM "tariffs" t
ON CONFLICT ("tariff_id", "key") DO NOTHING;

-- Standalone trial также получает data-driven primary template. squad_uuids
-- хранится legacy JSON-строкой, поэтому преобразуем только корректные JSON arrays.
INSERT INTO "trial_remnawave_components" (
  "id", "trial_id", "key", "admin_name", "required", "merge_order",
  "internal_squad_uuids", "traffic_limit_bytes", "traffic_reset_mode",
  "show_quota_to_client", "enabled", "created_at", "updated_at"
)
SELECT
  ('vcmp' || SUBSTRING(MD5(tr."id"), 1, 21))::TEXT,
  tr."id",
  'primary',
  'Основной',
  TRUE,
  0,
  CASE
    WHEN tr."squad_uuids" IS NOT NULL AND tr."squad_uuids" ~ '^\s*\['
      THEN ARRAY(SELECT JSONB_ARRAY_ELEMENTS_TEXT(tr."squad_uuids"::JSONB))
    ELSE ARRAY[]::TEXT[]
  END,
  tr."traffic_limit_bytes",
  'no_reset',
  FALSE,
  TRUE,
  NOW(),
  NOW()
FROM "trials" tr
WHERE tr."tariff_id" IS NULL
ON CONFLICT ("trial_id", "key") DO NOTHING;

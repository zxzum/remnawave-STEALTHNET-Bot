CREATE TYPE "TrafficLimitMode" AS ENUM ('REMNAWAVE', 'LOCAL_SQUAD');
CREATE TYPE "TrafficQuotaStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'SUSPENDED', 'CONFIG_ERROR');
CREATE TYPE "TrafficQuotaGrantScope" AS ENUM ('CURRENT_PERIOD', 'WHILE_TARIFF_ACTIVE');
CREATE TYPE "TrafficQuotaGrantStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

ALTER TABLE "tariffs"
  ADD COLUMN "traffic_limit_mode" "TrafficLimitMode" NOT NULL DEFAULT 'REMNAWAVE',
  ADD COLUMN "metered_squad_uuid" TEXT;

ALTER TABLE "trials"
  ADD COLUMN "traffic_limit_mode" "TrafficLimitMode" NOT NULL DEFAULT 'REMNAWAVE',
  ADD COLUMN "metered_squad_uuid" TEXT;

ALTER TABLE "subscriptions"
  ADD COLUMN "remnawave_username" TEXT,
  ADD COLUMN "remnawave_short_uuid" TEXT;

CREATE TABLE "squad_traffic_quotas" (
  "id" TEXT NOT NULL,
  "subscription_id" TEXT NOT NULL,
  "tariff_id_at_period_start" TEXT,
  "metered_squad_uuid" TEXT NOT NULL,
  "base_limit_bytes" BIGINT NOT NULL,
  "used_bytes" BIGINT NOT NULL DEFAULT 0,
  "period_started_at" TIMESTAMP(3) NOT NULL,
  "period_ends_at" TIMESTAMP(3) NOT NULL,
  "notified_percents" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "status" "TrafficQuotaStatus" NOT NULL DEFAULT 'ACTIVE',
  "exhausted_at" TIMESTAMP(3),
  "last_accounted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "squad_traffic_quotas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "traffic_quota_grants" (
  "id" TEXT NOT NULL,
  "quota_id" TEXT NOT NULL,
  "tariff_id_at_grant" TEXT,
  "scope" "TrafficQuotaGrantScope" NOT NULL,
  "status" "TrafficQuotaGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "bytes" BIGINT NOT NULL,
  "valid_period_start_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "traffic_quota_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "traffic_quota_events" (
  "id" TEXT NOT NULL,
  "quota_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "delta_bytes" BIGINT,
  "used_bytes" BIGINT NOT NULL,
  "limit_bytes" BIGINT NOT NULL,
  "detail" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "traffic_quota_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "squad_traffic_quotas_subscription_id_key" ON "squad_traffic_quotas"("subscription_id");
CREATE INDEX "squad_traffic_quotas_status_period_ends_at_idx" ON "squad_traffic_quotas"("status", "period_ends_at");
CREATE INDEX "traffic_quota_grants_quota_id_status_scope_idx" ON "traffic_quota_grants"("quota_id", "status", "scope");
CREATE INDEX "traffic_quota_events_quota_id_created_at_idx" ON "traffic_quota_events"("quota_id", "created_at" DESC);

ALTER TABLE "squad_traffic_quotas"
  ADD CONSTRAINT "squad_traffic_quotas_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "traffic_quota_grants"
  ADD CONSTRAINT "traffic_quota_grants_quota_id_fkey"
  FOREIGN KEY ("quota_id") REFERENCES "squad_traffic_quotas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "traffic_quota_events"
  ADD CONSTRAINT "traffic_quota_events_quota_id_fkey"
  FOREIGN KEY ("quota_id") REFERENCES "squad_traffic_quotas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

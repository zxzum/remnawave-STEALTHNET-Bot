CREATE TABLE "traffic_usage_checkpoints" (
  "id" TEXT NOT NULL,
  "subscription_id" TEXT NOT NULL,
  "squad_uuid" TEXT NOT NULL,
  "current_date" DATE,
  "current_observed_bytes" BIGINT NOT NULL DEFAULT 0,
  "previous_date" DATE,
  "previous_observed_bytes" BIGINT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "traffic_usage_checkpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "traffic_accounting_worker_state" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "last_started_at" TIMESTAMP(3),
  "last_succeeded_at" TIMESTAMP(3),
  "duration_ms" INTEGER,
  "processed_count" INTEGER NOT NULL DEFAULT 0,
  "changed_count" INTEGER NOT NULL DEFAULT 0,
  "api_request_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "observe_only" BOOLEAN NOT NULL DEFAULT true,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "traffic_accounting_worker_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "traffic_usage_checkpoints_subscription_id_key"
  ON "traffic_usage_checkpoints"("subscription_id");

CREATE INDEX "traffic_usage_checkpoints_squad_uuid_idx"
  ON "traffic_usage_checkpoints"("squad_uuid");

ALTER TABLE "traffic_usage_checkpoints"
  ADD CONSTRAINT "traffic_usage_checkpoints_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

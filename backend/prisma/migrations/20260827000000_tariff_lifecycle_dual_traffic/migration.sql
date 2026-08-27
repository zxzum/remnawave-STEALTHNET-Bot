ALTER TABLE "tariffs"
  ADD COLUMN "local_traffic_limit_bytes" BIGINT,
  ADD COLUMN "archived_at" TIMESTAMP(3);

-- До миграции LOCAL_SQUAD означал: traffic_limit_bytes — локальный лимит,
-- глобальный Remnawave принудительно безлимитный. Сохраняем поведение без потери данных.
UPDATE "tariffs"
SET "local_traffic_limit_bytes" = "traffic_limit_bytes",
    "traffic_limit_bytes" = NULL
WHERE "traffic_limit_mode" = 'LOCAL_SQUAD';

CREATE INDEX "tariffs_archived_at_idx" ON "tariffs"("archived_at");

ALTER TABLE "broadcast_history" ADD COLUMN IF NOT EXISTS "run_token" TEXT;
ALTER TABLE "broadcast_history" ADD COLUMN IF NOT EXISTS "heartbeat_at" TIMESTAMP(3);
ALTER TABLE "broadcast_history" ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "broadcast_history_status_lease_expires_at_idx"
  ON "broadcast_history"("status", "lease_expires_at");

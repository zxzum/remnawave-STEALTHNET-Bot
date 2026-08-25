ALTER TABLE "proxy_slots" ADD COLUMN IF NOT EXISTS "payment_id" TEXT;
ALTER TABLE "singbox_slots" ADD COLUMN IF NOT EXISTS "payment_id" TEXT;

CREATE INDEX IF NOT EXISTS "proxy_slots_payment_id_idx" ON "proxy_slots"("payment_id");
CREATE INDEX IF NOT EXISTS "singbox_slots_payment_id_idx" ON "singbox_slots"("payment_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proxy_slots_payment_id_fkey'
  ) THEN
    ALTER TABLE "proxy_slots"
      ADD CONSTRAINT "proxy_slots_payment_id_fkey"
      FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'singbox_slots_payment_id_fkey'
  ) THEN
    ALTER TABLE "singbox_slots"
      ADD CONSTRAINT "singbox_slots_payment_id_fkey"
      FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "pending_email_registrations"
  ADD COLUMN IF NOT EXISTS "delivery_state" TEXT NOT NULL DEFAULT 'SENT';

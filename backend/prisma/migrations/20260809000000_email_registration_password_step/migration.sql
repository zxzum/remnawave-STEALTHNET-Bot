ALTER TABLE "pending_email_registrations"
  ALTER COLUMN "password_hash" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "registration_ip" TEXT,
  ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "pending_email_registrations_email_created_at_idx"
  ON "pending_email_registrations"("email", "created_at");

CREATE INDEX IF NOT EXISTS "pending_email_registrations_registration_ip_created_at_idx"
  ON "pending_email_registrations"("registration_ip", "created_at");

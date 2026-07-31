ALTER TABLE "clients"
  ADD COLUMN "onboarding_reminder_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "onboarding_last_reminded_at" TIMESTAMP(3);

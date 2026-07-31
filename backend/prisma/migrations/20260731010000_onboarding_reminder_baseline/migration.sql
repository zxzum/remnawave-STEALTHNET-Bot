UPDATE "clients"
SET "onboarding_reminder_count" = 3
WHERE "onboarding_completed" = false
  AND "created_at" < TIMESTAMP '2026-07-31 10:25:00';

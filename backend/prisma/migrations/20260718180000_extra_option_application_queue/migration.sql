CREATE TYPE "ExtraOptionApplicationState" AS ENUM ('NEEDS_PLAN', 'PLANNING', 'PENDING', 'APPLYING', 'MANUAL_REVIEW', 'APPLIED', 'FAILED_SAFE');

ALTER TABLE "payments"
  ADD COLUMN "extra_option_state" "ExtraOptionApplicationState",
  ADD COLUMN "extra_option_claim_token" TEXT,
  ADD COLUMN "extra_option_next_attempt_at" TIMESTAMP(3);

CREATE INDEX "payments_extra_option_state_extra_option_next_attempt_at_idx"
  ON "payments"("extra_option_state", "extra_option_next_attempt_at");

CREATE UNIQUE INDEX "payments_one_uncertain_extra_option_per_subscription"
  ON "payments"("subscription_id")
  WHERE "extra_option_state" IN ('PLANNING', 'PENDING', 'APPLYING', 'MANUAL_REVIEW');

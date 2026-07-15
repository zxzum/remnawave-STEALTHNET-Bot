-- Persist the requested upstream operation for a deletion tombstone.
-- Existing rows intentionally remain NULL and are treated as DELETE for backwards compatibility.
CREATE TYPE "SubscriptionDeletionOperation" AS ENUM ('DELETE', 'REVOKE');

ALTER TABLE "subscriptions"
  ADD COLUMN "deletion_operation" "SubscriptionDeletionOperation";

CREATE INDEX "subscriptions_deletion_operation_idx"
  ON "subscriptions"("deletion_operation");

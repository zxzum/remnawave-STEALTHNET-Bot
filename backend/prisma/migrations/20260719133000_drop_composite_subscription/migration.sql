DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "remnawave_components" AS component
    WHERE component."remnawave_uuid" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "admin_events" AS event
        WHERE event."kind" = 'subscription.cutover.legacy_cleaned'
          AND event."payload" ->> 'uuid' = component."remnawave_uuid"
      )
  ) THEN
    RAISE EXCEPTION 'Composite cleanup proof is missing for at least one Remnawave component';
  END IF;
END $$;

DROP TABLE "trial_remnawave_components";
DROP TABLE "tariff_remnawave_components";
DROP TABLE "remnawave_components";
DROP INDEX "subscriptions_public_subscription_token_key";
ALTER TABLE "subscriptions" DROP COLUMN "public_subscription_token";

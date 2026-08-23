ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "slot_activation_state" TEXT;

-- Старые PAID proxy/Sing-box платежи без linkage неоднозначны: slots могли быть
-- выданы до появления payment_id. Не пытаемся угадывать связь и блокируем replay.
UPDATE "payments"
SET "slot_activation_state" = 'LEGACY_BLOCKED'
WHERE "slot_activation_state" IS NULL
  AND "status" = 'PAID'
  AND ("proxy_tariff_id" IS NOT NULL OR "singbox_tariff_id" IS NOT NULL);

-- PENDING платежи ещё не могли выдать slots, поэтому их будущая активация безопасна.
UPDATE "payments"
SET "slot_activation_state" = 'ELIGIBLE'
WHERE "slot_activation_state" IS NULL
  AND "status" = 'PENDING'
  AND ("proxy_tariff_id" IS NOT NULL OR "singbox_tariff_id" IS NOT NULL);

-- Новые платежи получают durable eligibility независимо от версии приложения,
-- создающей строку. Колонка остаётся nullable для backward compatibility.
ALTER TABLE "payments"
  ALTER COLUMN "slot_activation_state" SET DEFAULT 'ELIGIBLE';

ALTER TABLE "tariffs"
  ADD COLUMN "is_best_choice" BOOLEAN NOT NULL DEFAULT false;

UPDATE "tariffs"
SET "is_best_choice" = true
WHERE "description" ILIKE '%Лучший выбор%';

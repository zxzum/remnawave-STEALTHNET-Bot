-- AlterTable
ALTER TABLE "payments" ADD COLUMN "source" TEXT;

-- CreateTable
CREATE TABLE "provider_transactions" (
    "id" TEXT NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "external_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payment_method" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "payload" TEXT,
    "description" TEXT,
    "provider_created_at" TIMESTAMP(3),
    "raw" TEXT,
    "payment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_transactions_provider_external_id_key" ON "provider_transactions"("provider", "external_id");

-- CreateIndex
CREATE INDEX "provider_transactions_payment_id_idx" ON "provider_transactions"("payment_id");

-- CreateIndex
CREATE INDEX "provider_transactions_provider_created_at_idx" ON "provider_transactions"("provider", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payments_source_idx" ON "payments"("source");

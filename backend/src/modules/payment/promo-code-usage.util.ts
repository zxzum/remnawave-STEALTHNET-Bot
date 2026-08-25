import { prisma } from "../../db.js";

/**
 * Записать использование промокода (PromoCodeUsage) для оплаченного платежа.
 *
 * Читает `promoCodeId` из `Payment.metadata` (если был применён промо на скидку
 * при создании платежа). Безопасно вызывается несколько раз — на уникальности
 * пары promoCodeId+clientId+createdAt, но на всякий случай ловим ошибку.
 *
 * Вызывается **только** из вебхуков после перевода платежа в статус PAID — это
 * гарантирует, что счётчик использований инкрементится только на реально
 * оплаченные платежи, а не на абандонные.
 */
export async function recordPromoCodeUsageFromPayment(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, clientId: true, metadata: true, status: true },
  });
  if (!payment || payment.status !== "PAID") return;
  if (!payment.metadata) return;

  let promoCodeId: string | null = null;
  try {
    const parsed = JSON.parse(payment.metadata) as Record<string, unknown>;
    if (typeof parsed.promoCodeId === "string" && parsed.promoCodeId.trim()) {
      promoCodeId = parsed.promoCodeId.trim();
    }
  } catch {
    return;
  }
  if (!promoCodeId) return;

  try {
    await prisma.$transaction(async (tx) => {
      // The schema intentionally has no promoCodeId+clientId unique constraint:
      // maxUsesPerClient may allow more than one usage. Serialize the existing
      // semantic check/create instead of changing that cardinality contract.
      await tx.$queryRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        `${promoCodeId}:${payment.clientId}`,
      );
      const existing = await tx.promoCodeUsage.findFirst({
        where: { promoCodeId, clientId: payment.clientId },
        select: { id: true },
      });
      if (existing) return;
      await tx.promoCodeUsage.create({
        data: { promoCodeId, clientId: payment.clientId },
      });
    });
  } catch (err) {
    console.error(`[promo-code-usage] Failed to record usage for payment ${paymentId}:`, err);
  }
}

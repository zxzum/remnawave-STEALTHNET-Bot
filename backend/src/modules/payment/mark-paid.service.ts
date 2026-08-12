/**
 * Отметить платёж как оплаченный: обновление статуса, начисление баланса (топ-ап),
 * активация тарифа/прокси/singbox, реферальные бонусы.
 * Используется в веб-админке и в бот-админке.
 */

import { prisma } from "../../db.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { notifyProxySlotsCreated, notifySingboxSlotsCreated } from "../notification/telegram-notify.service.js";
import { auditPaymentClientBotAlignment } from "./payment-webhook-audit.util.js";
import { extinguishOneTimeDiscount } from "../client/personal-discount.js";
import { isPaidVpnPurchase, isVpnSubscriptionPurchase, markTrialUsedForPaidPurchase } from "../trial/trial-purchase-lock.service.js";

function hasExtraOptionInMetadata(metadata: string | null): boolean {
  if (!metadata?.trim()) return false;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    return obj?.extraOption != null && typeof obj.extraOption === "object";
  } catch {
    return false;
  }
}

export function shouldRetryPaidExtraOption(
  status: string,
  metadata: string | null,
  state: "NEEDS_PLAN" | "PLANNING" | "PENDING" | "APPLYING" | "MANUAL_REVIEW" | "APPLIED" | "FAILED_SAFE" | null,
): boolean {
  return status === "PAID"
    && hasExtraOptionInMetadata(metadata)
    && state != null
    && state !== "MANUAL_REVIEW"
    && state !== "APPLIED"
    && state !== "FAILED_SAFE";
}

export type MarkPaymentPaidResult = {
  ok: boolean;
  payment: Awaited<ReturnType<typeof prisma.payment.findUnique>>;
  referral?: Awaited<ReturnType<typeof distributeReferralRewards>>;
  activation?: { ok: boolean; error?: string; outcome?: "APPLIED" | "ALREADY_APPLIED" | "QUEUED" };
  proxySlots?: { ok: boolean; slotsCreated?: number; error?: string };
  balanceCredited?: boolean;
  error?: string;
};

export async function markPaymentPaid(paymentId: string): Promise<MarkPaymentPaidResult> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    return { ok: false, payment: null, error: "Payment not found" };
  }
  await auditPaymentClientBotAlignment({
    id: payment.id,
    clientId: payment.clientId,
  });
  if (payment.status === "PAID") {
    if (isPaidVpnPurchase(payment)) {
      try {
        await markTrialUsedForPaidPurchase(payment.clientId);
      } catch (error) {
        console.error("[trial-lock] failed to mark already-paid client", payment.clientId, error);
        return { ok: false, payment, error: "Не удалось зафиксировать использованный пробный период" };
      }
    }
    if (shouldRetryPaidExtraOption(payment.status, payment.metadata, payment.extraOptionState)) {
      const extraResult = await applyExtraOptionByPaymentId(paymentId);
      if (!extraResult.ok) {
        return { ok: false, payment, activation: extraResult, error: extraResult.error };
      }
      if (extraResult.outcome === "APPLIED") {
        const { notifyExtraOptionApplied } = await import("../notification/telegram-notify.service.js");
        await notifyExtraOptionApplied(payment.clientId, paymentId).catch(() => {});
      }
    }
    const result = await distributeReferralRewards(paymentId);
    const updated = await prisma.payment.findUnique({ where: { id: paymentId } });
    return { ok: true, payment: updated ?? payment, referral: result };
  }
  const now = new Date();
  const isExtraOption = hasExtraOptionInMetadata(payment.metadata);
  const isVpnProduct = isVpnSubscriptionPurchase(payment);
  const isTopUp =
    (payment.provider === "yoomoney_form" || payment.provider === "platega" || payment.provider === "yookassa") &&
    !payment.tariffId &&
    !payment.proxyTariffId &&
    !payment.singboxTariffId &&
    !isExtraOption &&
    !isVpnProduct;

  // Idempotent flip: PENDING → PAID. Если параллельный webhook (или повторный
  // ретрай провайдера) уже зафлипнул — count=0, сюда не лезем второй раз.
  // Без этой проверки: 2 webhook'а на один payment → 2 раза +balance.increment
  // (двойной топап). На бесподписном webhook'е (см. отчёт) — атакер мог фигачить
  // /webhooks/platega с одним paymentId сколько хочет.
  let flip: { count: number };
  if (isExtraOption) {
    flip = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT "id" FROM "payments" WHERE "id" = $1 FOR UPDATE', paymentId);
      const fresh = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!fresh || fresh.status !== "PENDING") return { count: 0 };
      const metadata = fresh.metadata ? JSON.parse(fresh.metadata) as Record<string, unknown> : {};
      const requestedId = typeof metadata.targetSubscriptionId === "string" ? metadata.targetSubscriptionId : null;
      const subscription = requestedId
        ? await tx.subscription.findFirst({
            where: { id: requestedId, deletionRequestedAt: null },
            select: { id: true, ownerId: true, giftedToClientId: true },
          })
        : await tx.subscription.findFirst({
            where: { ownerId: fresh.clientId, subscriptionIndex: 0, deletionRequestedAt: null },
            select: { id: true, ownerId: true, giftedToClientId: true },
          });
      if (!subscription || (subscription.ownerId !== fresh.clientId && subscription.giftedToClientId !== fresh.clientId)) {
        await tx.payment.update({ where: { id: paymentId }, data: { status: "PAID", paidAt: now, extraOptionState: "FAILED_SAFE" } });
        return { count: 1 };
      }
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: "PAID", paidAt: now, subscriptionId: subscription.id, extraOptionState: "NEEDS_PLAN", extraOptionNextAttemptAt: now },
      });
      return { count: 1 };
    });
  } else {
    flip = await prisma.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "PAID", paidAt: now },
    });
  }
  if (flip.count === 0) {
    // Уже PAID параллельным запросом — выходим как идемпотент.
    const updated = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (updated && isPaidVpnPurchase(updated)) {
      try {
        await markTrialUsedForPaidPurchase(updated.clientId);
      } catch (error) {
        console.error("[trial-lock] failed to mark concurrently-paid client", updated.clientId, error);
        return { ok: false, payment: updated, error: "Не удалось зафиксировать использованный пробный период" };
      }
    }
    const result = await distributeReferralRewards(paymentId);
    return { ok: true, payment: updated ?? payment, referral: result };
  }
  if (isVpnProduct) {
    try {
      await markTrialUsedForPaidPurchase(payment.clientId);
    } catch (error) {
      console.error("[trial-lock] failed to mark paid client", payment.clientId, error);
      return { ok: false, payment, error: "Не удалось зафиксировать использованный пробный период" };
    }
  }
  if (isTopUp) {
    // Списание баланса делаем ТОЛЬКО если flip нам "достался" (count=1).
    await prisma.client.update({
      where: { id: payment.clientId },
      data: { balance: { increment: payment.amount } },
    });
  }

  let activation: { ok: boolean; error?: string; outcome?: "APPLIED" | "ALREADY_APPLIED" | "QUEUED" } = { ok: false, error: "no tariff" };
  let proxySlots: { ok: boolean; slotsCreated?: number; error?: string } = { ok: false };
  if (isExtraOption) {
    const extraResult = await applyExtraOptionByPaymentId(paymentId);
    activation = extraResult.ok ? { ok: true, outcome: extraResult.outcome } : { ok: false, error: extraResult.error };
    if (!extraResult.ok) {
      const updated = await prisma.payment.findUnique({ where: { id: paymentId } });
      return { ok: false, payment: updated ?? payment, activation, error: extraResult.error };
    }
    if (extraResult.ok && extraResult.outcome === "APPLIED" && payment.clientId) {
      const { notifyExtraOptionApplied } = await import("../notification/telegram-notify.service.js");
      await notifyExtraOptionApplied(payment.clientId, paymentId).catch(() => {});
    }
  } else if (payment.tariffId || isVpnProduct) {
    activation = await activateTariffByPaymentId(paymentId);
  } else if (payment.proxyTariffId) {
    const proxyResult = await createProxySlotsByPaymentId(paymentId);
    if (proxyResult.ok) {
      proxySlots = { ok: true, slotsCreated: proxyResult.slotsCreated };
      const tariff = await prisma.proxyTariff.findUnique({
        where: { id: payment.proxyTariffId },
        select: { name: true },
      });
      await notifyProxySlotsCreated(
        payment.clientId,
        proxyResult.slotIds,
        tariff?.name ?? undefined
      ).catch(() => {});
    } else {
      proxySlots = { ok: false, error: proxyResult.error };
    }
  } else if (payment.singboxTariffId) {
    const singboxResult = await createSingboxSlotsByPaymentId(paymentId);
    if (singboxResult.ok) {
      proxySlots = { ok: true, slotsCreated: singboxResult.slotsCreated };
      const tariff = await prisma.singboxTariff.findUnique({
        where: { id: payment.singboxTariffId },
        select: { name: true },
      });
      await notifySingboxSlotsCreated(
        payment.clientId,
        singboxResult.slotIds,
        tariff?.name ?? undefined
      ).catch(() => {});
    } else {
      proxySlots = { ok: false, error: singboxResult.error };
    }
  }

  // сжигаем одноразовую персональную
  // скидку после продуктовой покупки. Топ-ап баланса НЕ сжигает.
  if (!isTopUp) {
    await extinguishOneTimeDiscount(payment.clientId);
  }

  const referral = await distributeReferralRewards(paymentId);
  const updated = await prisma.payment.findUnique({ where: { id: paymentId } });
  return {
    ok: true,
    payment: updated ?? payment,
    referral,
    activation,
    proxySlots: proxySlots.ok ? proxySlots : undefined,
    balanceCredited: isTopUp,
  };
}

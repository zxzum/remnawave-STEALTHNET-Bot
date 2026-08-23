/**
 * Webhook Lava.top — обрабатывает события подписок и разовых оплат.
 *
 * Поддерживаемые события:
 *   - payment.success                            — первая оплата (или ONE_TIME топ-ап)
 *   - payment.failed                             — ошибка
 *   - subscription.recurring.payment.success     — авто-списание раз в месяц
 *   - subscription.recurring.payment.failed      — ошибка авто-списания
 *   - subscription.cancelled                     — клиент отменил подписку
 *
 * Логика:
 *   • Тариф (lavatopOfferId на тарифе) → подписка MONTHLY:
 *       - первый webhook (payment.success) активирует тариф (durationDays)
 *       - каждый recurring webhook ПРОДЛЕВАЕТ тариф (создаёт новый payment + активация)
 *   • Топ-ап баланса → разовая оплата (ONE_TIME):
 *       - один webhook payment.success → +amount к балансу
 *
 * Авторизация — `X-Api-Key` (или `Authorization: Bearer`). Подписи HMAC у
 * Lava.top нет, просто сверяется ключ.
 *
 * Документация: https://developers.lava.top/ru
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { verifyLavatopWebhookAuth, parseLavatopWebhook, type LavatopWebhookEvent } from "../lavatop/lavatop.service.js";
import { markPaymentPaid } from "../payment/mark-paid.service.js";
import {
  notifyBalanceToppedUp,
  notifyTariffActivated,
} from "../notification/telegram-notify.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
import { auditPaymentClientBotAlignment } from "../payment/payment-webhook-audit.util.js";

function hasExtraOptionInMetadata(metadata: string | null): boolean {
  if (!metadata?.trim()) return false;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    return obj?.extraOption != null && typeof obj.extraOption === "object";
  } catch {
    return false;
  }
}

export const lavatopWebhooksRouter = Router();

type WebhookCompletionResult = { ok: boolean; error?: string };

/** Делегирует подтверждённый платёж общей locked/idempotent completion-службе. */
async function activatePayment(paymentId: string) {
  const result = await markPaymentPaid(paymentId);
  if (!result.ok || !result.payment) return result;

  const payment = result.payment;
  const isExtraOption = hasExtraOptionInMetadata(payment.metadata);
  if (result.balanceCredited) {
    await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "RUB", "Lava.top").catch(() => {});
  } else if (!isExtraOption && result.activation?.ok && !payment.proxyTariffId && !payment.singboxTariffId) {
    await notifyTariffActivated(payment.clientId, payment.id).catch(() => {});
  }
  return result;
}

/** Recurring renewal: клонирует исходный payment как PENDING и завершает общей службой. */
async function handleRecurringRenewal(event: LavatopWebhookEvent): Promise<WebhookCompletionResult> {
  const parentOrderId = event.parentContractId?.trim();
  const childOrderId = event.contractId?.trim();
  if (!parentOrderId || !childOrderId) {
    console.warn("[Lava.top Webhook] recurring без parentContractId/contractId", event);
    return { ok: true };
  }

  // Идемпотентность: уже создали payment для этого contractId?
  const alreadyProcessed = await prisma.payment.findFirst({
    where: { orderId: childOrderId, provider: "lavatop" },
    select: { id: true, status: true },
  });
  if (alreadyProcessed) {
    return activatePayment(alreadyProcessed.id);
  }

  // Находим исходный (parent) платёж — берём из него clientId, tariffId
  const parent = await prisma.payment.findFirst({
    where: { orderId: parentOrderId, provider: "lavatop" },
    select: {
      id: true,
      clientId: true,
      currency: true,
      tariffId: true,
      tariffPriceOptionId: true,
      subscriptionId: true,
      proxyTariffId: true,
      singboxTariffId: true,
      deviceCount: true,
      metadata: true,
    },
  });
  if (!parent) {
    console.warn("[Lava.top Webhook] recurring: parent payment не найден", { parentOrderId });
    return { ok: true };
  }

  // Сумма берётся из webhook'а (Lava сообщает фактически списанную сумму)
  const amount = event.amount ?? 0;
  const currency = (event.currency || parent.currency || "RUB").toLowerCase();

  // Помечаем в metadata что это recurring
  let metadata: Record<string, unknown> = {};
  if (parent.metadata) {
    try { metadata = JSON.parse(parent.metadata) as Record<string, unknown>; } catch { /* ignore */ }
  }
  delete metadata.subscriptionActivated;
  delete metadata.subscriptionId;
  metadata = {
    ...metadata,
    recurring: true,
    parentContractId: parentOrderId,
    parentPaymentId: parent.id,
    lavatopRenewalAt: new Date().toISOString(),
  };

  // Создаём новый payment для этого месяца (расширение подписки)
  const newPaymentId = `cm_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await prisma.payment.create({
    data: {
      id: newPaymentId,
      clientId: parent.clientId,
      orderId: childOrderId,
      amount,
      currency,
      status: "PENDING",
      provider: "lavatop",
      externalId: event.productId || null,
      tariffId: parent.tariffId,
      tariffPriceOptionId: parent.tariffPriceOptionId,
      subscriptionId: parent.subscriptionId,
      proxyTariffId: parent.proxyTariffId,
      singboxTariffId: parent.singboxTariffId,
      deviceCount: parent.deviceCount,
      metadata: JSON.stringify(metadata),
    },
  });

  console.log("[Lava.top Webhook] recurring renewal — создан payment", { id: newPaymentId, amount, currency });

  // Активация (продление) тарифа / прокси / singbox / etc
  return activatePayment(newPaymentId);
}

/** POST /api/webhooks/lavatop */
lavatopWebhooksRouter.post("/", async (req: Request, res: Response) => {
  const config = await getSystemConfig();
  const apiKey = (config as { lavatopApiKey?: string | null }).lavatopApiKey?.trim();
  if (!apiKey) {
    console.warn("[Lava.top Webhook] не настроено (нет lavatop_api_key)");
    return res.status(200).send("OK");
  }

  const xApiKey = req.header("x-api-key") || req.header("X-Api-Key") || undefined;
  const auth = req.header("authorization") || undefined;
  if (!verifyLavatopWebhookAuth(apiKey, { xApiKey, authorization: auth })) {
    console.warn("[Lava.top Webhook] неверный X-Api-Key");
    return res.status(401).send("Unauthorized");
  }

  const body = req.body;
  if (!body || typeof body !== "object") {
    console.warn("[Lava.top Webhook] пустое body");
    return res.status(200).send("OK");
  }

  const event = parseLavatopWebhook(body as Record<string, unknown>);
  console.log("[Lava.top Webhook]", {
    eventType: event.eventType,
    status: event.status,
    contractId: event.contractId,
    parentContractId: event.parentContractId,
    amount: event.amount,
    currency: event.currency,
    email: event.buyerEmail,
  });

  // ─── Отмена подписки клиентом ──────────────────────────────────
  if (event.status === "cancelled" || /subscription\.cancelled/i.test(event.eventType)) {
    // Просто фиксируем в логе. Не отменяем уже выданный тариф —
    // он истечёт по своему сроку. Дальше клиент платит новой подпиской если хочет.
    console.log("[Lava.top Webhook] подписка отменена", { contractId: event.contractId });
    return res.status(200).send("OK");
  }

  // Обрабатываем только успешные платежи — failed логируем и игнорим.
  if (event.status !== "success") {
    return res.status(200).send("OK");
  }

  // ─── Recurring renewal: subscription.recurring.payment.success ──
  if (/subscription\.recurring\.payment\.success/i.test(event.eventType)) {
    try {
      const result = await handleRecurringRenewal(event);
      if (!result.ok) {
        console.error("[Lava.top Webhook] recurring completion failed", result.error);
        return res.status(503).send("Retry");
      }
    } catch (e) {
      console.error("[Lava.top Webhook] ошибка recurring renewal:", e);
      return res.status(503).send("Retry");
    }
    return res.status(200).send("OK");
  }

  // ─── Первый платёж (payment.success / SUBSCRIPTION_FIRST_INVOICE) ──
  const orderId = event.contractId?.trim();
  if (!orderId) {
    console.warn("[Lava.top Webhook] нет contractId");
    return res.status(200).send("OK");
  }

  const payment = await prisma.payment.findFirst({
    where: { orderId, provider: "lavatop" },
    select: { id: true, status: true, provider: true, clientId: true, amount: true, currency: true, tariffId: true, proxyTariffId: true, singboxTariffId: true, metadata: true },
  });

  if (!payment) {
    console.warn("[Lava.top Webhook] payment не найден", { orderId });
    return res.status(200).send("OK");
  }

  await auditPaymentClientBotAlignment(payment);
  await prisma.payment.update({
    where: { id: payment.id },
    data: { externalId: event.productId || null },
  });

  const result = await activatePayment(payment.id);
  if (!result.ok) {
    console.error("[Lava.top Webhook] payment completion failed", result.error);
    return res.status(503).send("Retry");
  }
  await recordPromoCodeUsageFromPayment(payment.id);

  return res.status(200).send("OK");
});

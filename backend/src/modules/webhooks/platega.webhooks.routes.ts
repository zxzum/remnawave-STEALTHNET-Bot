/**
 * Webhook Platega:
 * - надёжно принимает разные форматы payload (orderId/externalId/transaction.id)
 * - идемпотентно переводит платежи PENDING -> PAID/FAILED
 * - топ-ап: зачисляет баланс атомарно вместе со сменой статуса
 * - тариф: активирует в Remna и распределяет реферальные (с ретраем по повторному webhook)
 *
 * Авторизация: обязательные X-MerchantId/X-Secret из официального callback Platega.
 * После этого транзакция повторно проверяется через GET /transaction/{id}, включая
 * id, сумму, валюту и payload. Raw body сохраняется для аудита и replay.
 */

import { Router } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import {
  getPlategaTransactionStatus,
  validatePlategaTransaction,
  verifyPlategaCallbackCredentials,
  type PlategaTransaction,
} from "../platega/platega.service.js";
import { recordWebhook, markOutcome } from "../webhook-inbox/webhook-inbox.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { notifyBalanceToppedUp, notifyTariffActivated, notifyTariffActivationFailed, notifyProxySlotsCreated, notifySingboxSlotsCreated, notifyPlategaPaymentEvent } from "../notification/telegram-notify.service.js";
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

function hasCustomBuildInMetadata(metadata: string | null): boolean {
  if (!metadata?.trim()) return false;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    return obj.customBuild != null && typeof obj.customBuild === "object";
  } catch {
    return false;
  }
}

export const plategaWebhooksRouter = Router();

type PaymentRow = {
  id: string;
  orderId: string;
  externalId: string | null;
  status: string;
  clientId: string;
  amount: number;
  currency: string;
  tariffId: string | null;
  proxyTariffId: string | null;
  singboxTariffId: string | null;
  subscriptionId: string | null;
  metadata: string | null;
};

const PAYMENT_SELECT = {
  id: true,
  orderId: true,
  externalId: true,
  status: true,
  clientId: true,
  amount: true,
  currency: true,
  tariffId: true,
  proxyTariffId: true,
  singboxTariffId: true,
  subscriptionId: true,
  metadata: true,
} as const;

const SUCCESS_STATUSES = new Set(["CONFIRMED", "PAID", "SUCCESS", "SUCCEEDED", "COMPLETED", "SUCCESSFUL", "APPROVED"]);
const FAILED_STATUSES = new Set(["CANCELED", "CANCELLED", "FAILED", "DECLINED", "REJECTED", "ERROR", "EXPIRED", "CHARGEBACK", "CHARGEBACKED"]);
let invalidCredentialsNotifiedAt = 0;

type Meta = Record<string, unknown> & {
  plategaActivationAppliedAt?: string;
  plategaActivationInProgressAt?: string;
  plategaActivationAttempts?: number;
  plategaActivationLastError?: string | null;
  plategaNotificationSentAt?: string;
};

function pickFirstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function parseMeta(raw: string | null): Meta {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Meta;
  } catch {
    return {};
  }
}

async function findPlategaPayment(transactionId: string): Promise<PaymentRow | null> {
  const payments = await prisma.payment.findMany({
    where: { provider: "platega", externalId: transactionId },
    select: PAYMENT_SELECT,
    take: 2,
  });
  if (payments.length > 1) throw new Error(`Duplicate Platega externalId: ${transactionId}`);
  return payments[0] ?? null;
}

type ActivationOutcome =
  /** активация выполнена этим вызовом */
  | { applied: true; ok: true }
  /** активация выполнялась этим вызовом и упала */
  | { applied: true; ok: false; error: string }
  /** делать было нечего: уже применена ранее / in_progress / не PAID */
  | { applied: false; ok: true; reason: string };

async function ensureTariffActivation(paymentId: string): Promise<ActivationOutcome> {
  const claim = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT "id" FROM "payments" WHERE "id" = $1 FOR UPDATE', paymentId);
    const row = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { status: true, tariffId: true, proxyTariffId: true, singboxTariffId: true, subscriptionId: true, metadata: true, clientId: true },
    });
    const hasMetadataProduct = hasExtraOptionInMetadata(row?.metadata ?? null) || hasCustomBuildInMetadata(row?.metadata ?? null);
    if (!row || row.status !== "PAID" || (!row.tariffId && !row.proxyTariffId && !row.singboxTariffId && !hasMetadataProduct)) {
      return { claimed: false as const, reason: "not_paid_or_no_tariff" };
    }

    const meta = parseMeta(row.metadata);
    if (typeof meta.plategaActivationAppliedAt === "string" && meta.plategaActivationAppliedAt.trim()) {
      return { claimed: false as const, reason: "already_applied" };
    }
    if (row.subscriptionId && (row.tariffId || hasCustomBuildInMetadata(row.metadata))) {
      await tx.payment.update({
        where: { id: paymentId },
        data: { metadata: JSON.stringify({ ...meta, plategaActivationAppliedAt: new Date().toISOString() }) },
      });
      return { claimed: false as const, reason: "already_applied" };
    }

    const inProgressAt = typeof meta.plategaActivationInProgressAt === "string" ? new Date(meta.plategaActivationInProgressAt) : null;
    const freshInProgress = inProgressAt && Number.isFinite(inProgressAt.getTime()) && Date.now() - inProgressAt.getTime() < 10 * 60 * 1000;
    if (freshInProgress) {
      return { claimed: false as const, reason: "in_progress" };
    }

    const next: Meta = {
      ...meta,
      plategaActivationInProgressAt: new Date().toISOString(),
      plategaActivationAttempts: Number(meta.plategaActivationAttempts ?? 0) + 1,
    };
    await tx.payment.update({
      where: { id: paymentId },
      data: { metadata: JSON.stringify(next) },
    });
    return { claimed: true as const, reason: "claimed" };
  });

  if (!claim.claimed) return { applied: false, ok: true, reason: claim.reason };

  const row = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { tariffId: true, proxyTariffId: true, singboxTariffId: true, clientId: true, metadata: true },
  });
  const isExtraOption = row ? hasExtraOptionInMetadata(row.metadata) : false;
  let activation: { ok: boolean; error?: string; slotIds?: string[]; outcome?: "APPLIED" | "ALREADY_APPLIED" | "QUEUED" } = { ok: false };
  try {
    if (isExtraOption) {
      activation = await applyExtraOptionByPaymentId(paymentId);
      if (activation.ok && activation.outcome === "APPLIED" && row?.clientId) {
        const { notifyExtraOptionApplied } = await import("../notification/telegram-notify.service.js");
        await notifyExtraOptionApplied(row.clientId, paymentId).catch((error) => {
          console.error("[Platega Webhook] Extra-option notification failed", { paymentId, error });
        });
      }
    } else if (row?.proxyTariffId) {
      const proxyResult = await createProxySlotsByPaymentId(paymentId);
      activation = proxyResult.ok ? { ok: true, slotIds: proxyResult.slotIds } : { ok: false, error: proxyResult.error };
      if (activation.ok && activation.slotIds?.length && row.clientId) {
        const tariff = await prisma.proxyTariff.findUnique({ where: { id: row.proxyTariffId! }, select: { name: true } });
        await notifyProxySlotsCreated(row.clientId, activation.slotIds, tariff?.name ?? undefined).catch((error) => {
          console.error("[Platega Webhook] Proxy notification failed", { paymentId, error });
        });
      }
    } else if (row?.singboxTariffId) {
      const singboxResult = await createSingboxSlotsByPaymentId(paymentId);
      activation = singboxResult.ok ? { ok: true, slotIds: singboxResult.slotIds } : { ok: false, error: singboxResult.error };
      if (activation.ok && activation.slotIds?.length && row.clientId) {
        const tariff = await prisma.singboxTariff.findUnique({ where: { id: row.singboxTariffId }, select: { name: true } });
        await notifySingboxSlotsCreated(row.clientId, activation.slotIds, tariff?.name ?? undefined).catch((error) => {
          console.error("[Platega Webhook] Sing-box notification failed", { paymentId, error });
        });
      }
    } else {
      activation = await activateTariffByPaymentId(paymentId);
    }
  } catch (error) {
    activation = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  await prisma.$transaction(async (tx) => {
    const row = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { metadata: true },
    });
    const meta = parseMeta(row?.metadata ?? null);
    const next: Meta = { ...meta };
    delete next.plategaActivationInProgressAt;
    if (activation.ok && activation.outcome !== "QUEUED") {
      next.plategaActivationAppliedAt = new Date().toISOString();
      next.plategaActivationLastError = null;
    } else if (activation.ok) {
      next.plategaActivationLastError = null;
    } else {
      next.plategaActivationLastError = activation.error;
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: { metadata: JSON.stringify(next) },
    });
  });

  if (activation.ok && activation.outcome === "QUEUED") {
    return { applied: false, ok: true, reason: "queued" };
  }
  if (activation.ok) {
    console.log("[Platega Webhook] Tariff activated", { paymentId });
    return { applied: true, ok: true };
  }
  console.error("[Platega Webhook] Tariff activation failed", { paymentId, error: activation.error });
  return { applied: true, ok: false, error: activation.error ?? "unknown activation error" };
}

async function notifyTariffActivationIfNeeded(
  clientId: string,
  paymentId: string,
  outcome: ActivationOutcome,
): Promise<boolean> {
  if (!(outcome.ok && (outcome.applied || outcome.reason === "already_applied"))) return true;

  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { metadata: true } });
  const meta = parseMeta(payment?.metadata ?? null);
  if (meta.plategaNotificationSentAt) return true;

  try {
    if (!await notifyTariffActivated(clientId, paymentId)) return false;
    await prisma.payment.update({
      where: { id: paymentId },
      data: { metadata: JSON.stringify({ ...meta, plategaNotificationSentAt: new Date().toISOString() }) },
    });
    return true;
  } catch (error) {
    console.error("[Platega Webhook] Tariff notification failed", { paymentId, error });
    return false;
  }
}

export async function completePlategaPayment(paymentId: string): Promise<{ ok: boolean; changed: boolean; activated: boolean; error?: string }> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: PAYMENT_SELECT });
  if (!payment) return { ok: false, changed: false, activated: false, error: "Payment not found" };
  const isExtraOption = hasExtraOptionInMetadata(payment.metadata);
  const isMetadataProduct = isExtraOption || hasCustomBuildInMetadata(payment.metadata);
  const isTopUp = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !isMetadataProduct;

  const changed = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT "id" FROM "payments" WHERE "id" = $1 FOR UPDATE', payment.id);
    const fresh = await tx.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    if (!fresh || fresh.status !== "PENDING") return false;
    await tx.payment.update({ where: { id: payment.id }, data: { status: "PAID", paidAt: new Date() } });
    if (isTopUp) await tx.client.update({ where: { id: payment.clientId }, data: { balance: { increment: payment.amount } } });
    return true;
  });

  if (changed && isTopUp) {
    await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "RUB", "Platega").catch(() => {});
  }
  await recordPromoCodeUsageFromPayment(payment.id);
  const activationOutcome = await ensureTariffActivation(payment.id);
  if (!activationOutcome.ok) {
    const notify = payment.tariffId
      ? notifyTariffActivationFailed(payment.clientId, payment.id, activationOutcome.error)
      : notifyPlategaPaymentEvent({ kind: "callback_failed", paymentId: payment.id, transactionId: payment.externalId, details: activationOutcome.error });
    await notify.catch(() => {});
    return { ok: false, changed, activated: false, error: activationOutcome.error };
  }
  if (payment.tariffId || hasCustomBuildInMetadata(payment.metadata)) {
    await notifyTariffActivationIfNeeded(payment.clientId, payment.id, activationOutcome).catch(() => false);
  } else if (!isTopUp && activationOutcome.applied) {
    await notifyPlategaPaymentEvent({ kind: "service_issued", paymentId: payment.id, transactionId: payment.externalId }).catch(() => {});
  }
  if (!isTopUp) {
    const { extinguishOneTimeDiscount } = await import("../client/personal-discount.js");
    await extinguishOneTimeDiscount(payment.clientId).catch(() => {});
  }
  await distributeReferralRewards(payment.id).catch((error) => console.error("[Platega Webhook] Referral distribution error", error));
  return { ok: true, changed, activated: activationOutcome.applied };
}

plategaWebhooksRouter.get("/platega", (_req, res) => res.json({ ok: true, provider: "platega" }));

plategaWebhooksRouter.post("/platega", async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : "");
  const captured = await recordWebhook("platega", req, rawBody);
  const ack = (status: number, outcome: Parameters<typeof markOutcome>[2], errorMessage?: string, paymentId?: string | null) => {
    void markOutcome(captured, status, outcome, { errorMessage, paymentId });
  };

  try {
    const config = await getSystemConfig();
    const credentials = { merchantId: config.plategaMerchantId?.trim() ?? "", secret: config.plategaSecret?.trim() ?? "" };
    if (!credentials.merchantId || !credentials.secret) {
      ack(503, "error", "Platega credentials not configured");
      await notifyPlategaPaymentEvent({ kind: "callback_failed", details: "Merchant ID/Secret не настроены" }).catch(() => {});
      return res.status(503).json({ message: "Platega is not configured" });
    }
    if (!verifyPlategaCallbackCredentials(req.headers, credentials)) {
      ack(401, "rejected_signature", "Invalid X-MerchantId/X-Secret");
      if (req.headers["x-merchantid"] === credentials.merchantId && Date.now() - invalidCredentialsNotifiedAt > 5 * 60_000) {
        invalidCredentialsNotifiedAt = Date.now();
        await notifyPlategaPaymentEvent({ kind: "callback_failed", details: "Platega прислал неверный X-Secret" }).catch(() => {});
      }
      return res.status(401).json({ message: "Invalid callback credentials" });
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      ack(400, "rejected_payload", "Invalid JSON");
      await notifyPlategaPaymentEvent({ kind: "callback_failed", details: "Platega прислал невалидный JSON" }).catch(() => {});
      return res.status(400).json({ message: "Invalid JSON" });
    }
    const transactionId = pickFirstString(data.id, data.Id);
    const callbackStatus = pickFirstString(data.status, data.Status)?.toUpperCase() ?? "";
    const amountRaw = data.amount ?? data.Amount;
    const amount = typeof amountRaw === "number" ? amountRaw : typeof amountRaw === "string" ? Number(amountRaw) : undefined;
    const currency = pickFirstString(data.currency, data.Currency) ?? undefined;
    const payload = pickFirstString(data.payload, data.Payload) ?? undefined;
    if (!transactionId || !callbackStatus || !Number.isFinite(amount)) {
      ack(400, "rejected_payload", "Missing id/status/amount");
      await notifyPlategaPaymentEvent({ kind: "callback_failed", transactionId, details: "Callback без обязательных id/status/amount" }).catch(() => {});
      return res.status(400).json({ message: "Invalid callback payload" });
    }

    const payment = await findPlategaPayment(transactionId);
    if (!payment) {
      ack(200, "payment_not_found", `transaction=${transactionId}`);
      await notifyPlategaPaymentEvent({ kind: "callback_failed", transactionId, details: "Платёж с таким transaction ID не найден" }).catch(() => {});
      return res.status(200).json({ received: true });
    }
    await auditPaymentClientBotAlignment(payment);
    const callbackTransaction: PlategaTransaction = { id: transactionId, status: callbackStatus, amount, currency, payload, raw: data };
    // Callback содержит gross amount (заказ + комиссия Platega). Точный net amount
    // ниже сверяется по авторитетному GET /transaction/{id}, где есть `comission`.
    const callbackMismatch = validatePlategaTransaction(callbackTransaction, payment, true);
    if (callbackMismatch) {
      ack(409, "rejected_payload", callbackMismatch, payment.id);
      await notifyPlategaPaymentEvent({ kind: "callback_failed", paymentId: payment.id, transactionId, details: `Callback ${callbackMismatch}` }).catch(() => {});
      return res.status(409).json({ message: "Callback does not match payment" });
    }

    const apiTransaction = await getPlategaTransactionStatus(credentials, transactionId);
    if ("error" in apiTransaction) {
      ack(503, "error", apiTransaction.error, payment.id);
      await notifyPlategaPaymentEvent({ kind: "callback_failed", paymentId: payment.id, transactionId, details: apiTransaction.error, callbackAvailable: true }).catch(() => {});
      return res.status(503).json({ message: "Unable to verify transaction" });
    }
    const apiMismatch = validatePlategaTransaction(apiTransaction, payment, true);
    if (apiMismatch) {
      ack(409, "rejected_payload", `API ${apiMismatch}`, payment.id);
      await notifyPlategaPaymentEvent({ kind: "callback_failed", paymentId: payment.id, transactionId, details: `Platega API ${apiMismatch}` }).catch(() => {});
      return res.status(409).json({ message: "Transaction does not match payment" });
    }

    const status = apiTransaction.status.toUpperCase();
    if (FAILED_STATUSES.has(status)) {
      const failed = await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
      if (failed.count) await notifyPlategaPaymentEvent({ kind: "canceled", paymentId: payment.id, transactionId, details: `status=${status}` }).catch(() => {});
      ack(200, "payment_failed", `provider status=${status}`, payment.id);
      return res.status(200).json({ received: true });
    }
    if (!SUCCESS_STATUSES.has(status)) {
      ack(200, "ignored_event", `status=${status}`, payment.id);
      return res.status(200).json({ received: true });
    }

    const result = await completePlategaPayment(payment.id);
    if (!result.ok) {
      ack(500, "error", result.error, payment.id);
      return res.status(500).json({ message: "Payment activation failed" });
    }
    ack(200, "accepted", undefined, payment.id);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("[Platega Webhook] Error:", error);
    ack(500, "error", String(error));
    await notifyPlategaPaymentEvent({ kind: "callback_failed", details: String(error), callbackAvailable: true }).catch(() => {});
    return res.status(500).json({ message: "Webhook processing failed" });
  }
});

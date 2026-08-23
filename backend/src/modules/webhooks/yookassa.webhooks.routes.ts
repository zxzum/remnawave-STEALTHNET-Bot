/**
 * Webhook ЮKassa — уведомления о статусе платежа (JSON).
 * Событие payment.succeeded: помечаем платёж PAID, активируем тариф или зачисляем баланс, рефералы.
 * Документация: https://yookassa.ru/developers/using-api/webhooks
 *
 * Аутентификация:
 * - YooKassa поддерживает HTTP Basic Auth на webhook URL. Админ настраивает это в кабинете
 *   ЮKassa: webhook URL вида https://user:pass@panel.example.com/api/webhooks/yookassa.
 *   Админ задаёт `yookassa_webhook_basic_user` / `yookassa_webhook_basic_password` в админке.
 * - После basic-auth подтверждаем платёж через YooKassa API и сверяем его с локальной
 *   записью — webhook payload сам по себе не является доказательством оплаты.
 */

import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { getYookassaPayment, validateYookassaPayment } from "../yookassa/yookassa.service.js";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { markPaymentPaid, shouldRetryPaidActivation } from "../payment/mark-paid.service.js";
import { notifyBalanceToppedUp, notifyTariffActivated } from "../notification/telegram-notify.service.js";
import { createNalogReceipt } from "../nalog/nalog.service.js";
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

export const yookassaWebhooksRouter = Router();

yookassaWebhooksRouter.get("/yookassa", (_req, res) => {
  res.status(200).json({ status: "ok", message: "YooKassa webhook is available" });
});

type YookassaNotification = {
  type?: string;
  event?: string;
  object?: {
    id?: string;
    status?: string;
    amount?: { value?: string; currency?: string };
    metadata?: Record<string, string>;
    payment_method?: {
      type?: string;
      id?: string;
      saved?: boolean;
      title?: string;
      card?: { last4?: string; card_type?: string };
    };
  };
};

/**
 * Constant-time-сравнение двух строк через timingSafeEqual.
 * Возвращает false при разных длинах — это безопасно (длина ожидаемой строки не секрет).
 */
function safeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Проверяет HTTP Basic Auth заголовок против `yookassa_webhook_basic_user/password`
 * из system_settings. Возвращает true если все ОК или basic-auth выключен (нет пароля).
 *
 * SECURITY: если в админке не задан пароль — webhook проходит только после подтверждения
 * через YooKassa API. Чтобы включить дополнительный слой — задаёшь user+password,
 * затем в кабинете ЮKassa прописываешь URL вида `https://USER:PASS@panel.example.com/...`.
 * Когда пароль задан — все запросы без или с неверным auth получают 401.
 */
async function verifyYookassaWebhookAuth(req: { headers: Record<string, unknown> }): Promise<{ ok: boolean; reason?: string }> {
  const config = await getSystemConfig();
  const expectedUser = (config as { yookassaWebhookBasicUser?: string | null }).yookassaWebhookBasicUser?.trim();
  const expectedPass = (config as { yookassaWebhookBasicPassword?: string | null }).yookassaWebhookBasicPassword?.trim();

  // Не настроено — пропускаем только после подтверждения через YooKassa API.
  if (!expectedUser || !expectedPass) {
    console.warn("[YooKassa Webhook] BASIC AUTH NOT CONFIGURED — using YooKassa API confirmation. Set yookassaWebhookBasicUser / yookassaWebhookBasicPassword for an additional check.");
    return { ok: false, reason: "no_credentials_configured" };
  }

  const authHeader = (req.headers["authorization"] ?? req.headers["Authorization"]) as string | undefined;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return { ok: false, reason: "missing_basic_auth" };
  }

  let decoded: string;
  try {
    decoded = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return { ok: false, reason: "invalid_base64" };
  }

  const colonIdx = decoded.indexOf(":");
  if (colonIdx < 0) return { ok: false, reason: "invalid_format" };
  const gotUser = decoded.slice(0, colonIdx);
  const gotPass = decoded.slice(colonIdx + 1);

  if (!safeStringEqual(gotUser, expectedUser) || !safeStringEqual(gotPass, expectedPass)) {
    return { ok: false, reason: "wrong_credentials" };
  }
  return { ok: true };
}

yookassaWebhooksRouter.post("/yookassa", async (req, res) => {
  // ВАЖНО: проверка аутентификации ПЕРЕД любыми DB-операциями.
  const auth = await verifyYookassaWebhookAuth(req);
  const basicAuthNotConfigured = !auth.ok && auth.reason === "no_credentials_configured";
  if (!auth.ok && !basicAuthNotConfigured) {
    console.warn(`[YooKassa Webhook] Auth failed: ${auth.reason}`);
    res.set("WWW-Authenticate", 'Basic realm="yookassa-webhook"');
    return res.status(401).json({ message: "Unauthorized" });
  }

  let body: YookassaNotification = {};
  if (req.body && typeof req.body === "object") {
    body = req.body as YookassaNotification;
  }
  if (!body.object?.metadata?.payment_id) {
    console.warn("[YooKassa Webhook] Missing or invalid body/object/metadata.payment_id", {
      hasBody: !!req.body,
      event: body.event,
    });
    return res.status(200).send("OK");
  }

  const event = body.event ?? "";
  const paymentId = body.object?.metadata?.payment_id?.trim();
  if (!paymentId) {
    return res.status(200).send("OK");
  }

  if (event !== "payment.succeeded") {
    console.log("[YooKassa Webhook] Ignored event", { event, paymentId });
    return res.status(200).send("OK");
  }

  const externalId = body.object?.id?.trim();
  if (!externalId) {
    console.warn("[YooKassa Webhook] Missing provider payment id", { paymentId });
    return res.status(200).send("OK");
  }

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, provider: "yookassa" },
    select: {
      id: true,
      clientId: true,
      externalId: true,
      amount: true,
      currency: true,
      tariffId: true,
      proxyTariffId: true,
      singboxTariffId: true,
      status: true,
      metadata: true,
    },
  });

  if (!payment) {
    console.warn("[YooKassa Webhook] Payment not found", { paymentId });
    return res.status(200).send("OK");
  }

  await auditPaymentClientBotAlignment(payment);

  const config = await getSystemConfig();
  const paymentLookup = await getYookassaPayment(externalId, config);
  if (!paymentLookup.ok) {
    console.warn("[YooKassa Webhook] Payment confirmation lookup failed", {
      paymentId,
      externalId,
      error: paymentLookup.error,
      status: paymentLookup.status,
      kind: paymentLookup.kind,
    });
    if (paymentLookup.kind === "transient") {
      return res.status(503).send("Retry");
    }
    return res.status(200).send("OK");
  }
  const confirmedPayment = paymentLookup.payment;
  const validation = validateYookassaPayment(payment, confirmedPayment, externalId);
  if (!validation.ok) {
    console.warn("[YooKassa Webhook] Payment confirmation mismatch", {
      paymentId,
      externalId,
      reason: validation.reason,
    });
    return res.status(200).send("OK");
  }
  if (basicAuthNotConfigured) {
    console.log("[YooKassa Webhook] Confirmed by YooKassa API (Basic Auth not configured)", { paymentId });
  }

  const isExtraOption = hasExtraOptionInMetadata(payment.metadata);

  if (payment.status === "PAID" && !isExtraOption && !shouldRetryPaidActivation(payment)) {
    console.log("[YooKassa Webhook] Already processed", { paymentId });
    return res.status(200).send("OK");
  }

  await prisma.payment.update({ where: { id: payment.id }, data: { externalId } });

  // Сохраняем способ оплаты для рекуррентных платежей
  const pm = confirmedPayment.payment_method;
  if (pm?.saved && pm.id) {
    const title = pm.title || (pm.card?.last4 ? `Карта *${pm.card.last4}` : pm.type || "Сохранённый способ");
    await prisma.client.update({
      where: { id: payment.clientId },
      data: {
        yookassaPaymentMethodId: pm.id,
        yookassaPaymentMethodTitle: title,
      },
    });
    console.log("[YooKassa Webhook] Saved payment method", {
      clientId: payment.clientId,
      paymentMethodId: pm.id,
      title,
    });
  }

  const result = await markPaymentPaid(payment.id);
  if (!result.ok) {
    console.error("[YooKassa Webhook] Payment completion failed", {
      paymentId: payment.id,
      error: result.error,
    });
    return res.status(503).send("Retry");
  }
  await recordPromoCodeUsageFromPayment(payment.id);

  if (result.balanceCredited) {
    console.log("[YooKassa Webhook] Payment PAID, balance credited (top-up)", {
      paymentId: payment.id,
      clientId: payment.clientId,
      amount: payment.amount,
    });
    await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "RUB", "YooKassa").catch(() => {});
  } else if (!isExtraOption && result.activation?.ok && !payment.proxyTariffId && !payment.singboxTariffId) {
    console.log("[YooKassa Webhook] Tariff activated", { paymentId: payment.id });
    await notifyTariffActivated(payment.clientId, payment.id).catch(() => {});
  }

  const tariffForReceipt = payment.tariffId
    ? await prisma.tariff.findUnique({ where: { id: payment.tariffId }, select: { name: true } }).catch(() => null)
    : null;
  const receiptDesc = tariffForReceipt?.name ? `Оплата тарифа «${tariffForReceipt.name}»` : "Пополнение баланса";
  createNalogReceipt({
    paymentId: payment.id,
    amount: payment.amount,
    currency: payment.currency || "RUB",
    description: receiptDesc,
    paidAt: new Date(),
  }).catch((e) => {
    console.warn("[YooKassa Webhook] Nalog receipt error (non-critical):", e);
  });

  return res.status(200).send("OK");
});

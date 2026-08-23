/**
 * Webhook Crypto Pay (Crypto Bot): update_type invoice_paid.
 * Проверка подписи: HMAC-SHA256(rawBody, SHA256(token)).
 * Документация: https://help.send.tg/en/articles/10279948-crypto-pay-api
 */

import { Router, Request, Response } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { verifyCryptopayWebhookSignature } from "../cryptopay/cryptopay.service.js";
import { markPaymentPaid } from "../payment/mark-paid.service.js";
import { notifyBalanceToppedUp, notifyTariffActivated } from "../notification/telegram-notify.service.js";
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

export const cryptopayWebhooksRouter = Router();

type CryptopayWebhookPayload = {
  update_type?: string;
  payload?: { payload?: string; invoice_id?: number; status?: string };
};

/** POST /api/webhooks/cryptopay — вызывается с express.raw(), req.body = Buffer */
cryptopayWebhooksRouter.post("/", async (req: Request, res: Response) => {
  const rawBody = req.body;
  const rawString = typeof rawBody === "string" ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : "";
  if (!rawString) {
    console.warn("[Crypto Pay Webhook] Empty body");
    return res.status(200).send("OK");
  }

  const config = await getSystemConfig();
  const token = (config as { cryptopayApiToken?: string | null }).cryptopayApiToken?.trim();
  if (!token) {
    console.warn("[Crypto Pay Webhook] Crypto Pay not configured");
    return res.status(200).send("OK");
  }

  const signature = req.headers["crypto-pay-api-signature"] as string | undefined;
  if (!verifyCryptopayWebhookSignature(token, rawString, signature)) {
    console.warn("[Crypto Pay Webhook] Invalid signature");
    return res.status(401).send("Invalid signature");
  }

  let body: CryptopayWebhookPayload;
  try {
    body = JSON.parse(rawString) as CryptopayWebhookPayload;
  } catch {
    console.warn("[Crypto Pay Webhook] Invalid JSON");
    return res.status(200).send("OK");
  }

  if (body.update_type !== "invoice_paid" || !body.payload?.payload) {
    return res.status(200).send("OK");
  }

  const paymentId = body.payload.payload.trim();
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, provider: "cryptopay" },
    select: {
      id: true,
      clientId: true,
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
    console.warn("[Crypto Pay Webhook] Payment not found", { paymentId });
    return res.status(200).send("OK");
  }

  await auditPaymentClientBotAlignment(payment);

  const isExtraOption = hasExtraOptionInMetadata(payment.metadata);
  const invoiceId = body.payload.invoice_id ?? null;
  if (invoiceId != null) {
    await prisma.payment.update({ where: { id: payment.id }, data: { externalId: String(invoiceId) } });
  }

  const result = await markPaymentPaid(payment.id, { allowFailedRecovery: true });
  if (!result.ok) {
    console.error("[Crypto Pay Webhook] Payment completion failed", { paymentId: payment.id, error: result.error });
    return res.status(503).send("Retry");
  }
  await recordPromoCodeUsageFromPayment(payment.id);

  if (result.balanceCredited) {
    await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "USD", "CryptoPay").catch(() => {});
  } else if (!isExtraOption && result.activation?.ok && !payment.proxyTariffId && !payment.singboxTariffId) {
    await notifyTariffActivated(payment.clientId, payment.id).catch(() => {});
  }

  return res.status(200).send("OK");
});

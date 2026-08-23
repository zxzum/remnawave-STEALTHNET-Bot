/**
 * RollyPay webhook.
 *
 * This router must be mounted behind express.raw({ type: "application/json" })
 * because RollyPay signs `X-Timestamp + "." + rawBody`.
 */

import { Router, type Request, type Response } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import {
  getRollypayPayment,
  validateRollypayPayment,
  verifyRollypayWebhookSignature,
  type RollypayConfig,
  type RollypayWebhookPayload,
} from "../rollypay/rollypay.service.js";
import { markPaymentPaid } from "../payment/mark-paid.service.js";
import { auditPaymentClientBotAlignment } from "../payment/payment-webhook-audit.util.js";

export const rollypayWebhooksRouter = Router();

type RollypaySystemConfig = {
  rollypayApiKey?: string | null;
  rollypaySigningSecret?: string | null;
  rollypayTestMode?: boolean;
};

function rawBodyToString(body: unknown): string {
  if (typeof body === "string") return body;
  return Buffer.isBuffer(body) ? body.toString("utf8") : "";
}

rollypayWebhooksRouter.post("/", async (req: Request, res: Response) => {
  const rawBody = rawBodyToString(req.body);
  if (!rawBody) return res.status(400).send("Invalid body");

  try {
    const config = await getSystemConfig() as RollypaySystemConfig;
    const rollypayConfig: RollypayConfig = {
      apiKey: config.rollypayApiKey?.trim() ?? "",
      signingSecret: config.rollypaySigningSecret?.trim() ?? "",
      testMode: config.rollypayTestMode === true,
    };
    if (!rollypayConfig.signingSecret) return res.status(503).send("Not configured");

    const timestamp = req.header("x-timestamp") ?? undefined;
    const signature = req.header("x-signature") ?? undefined;
    if (!verifyRollypayWebhookSignature(rollypayConfig.signingSecret, rawBody, timestamp, signature)) {
      return res.status(401).send("Invalid signature");
    }

    let webhook: RollypayWebhookPayload;
    try {
      webhook = JSON.parse(rawBody) as RollypayWebhookPayload;
    } catch {
      return res.status(400).send("Invalid JSON");
    }

    if ((webhook.status ?? "").trim().toLowerCase() !== "paid") {
      return res.status(200).send("OK");
    }

    const orderId = webhook.order_id?.trim();
    const paymentId = webhook.payment_id?.trim();
    if (!orderId || !paymentId) return res.status(200).send("OK");

    const payment = await prisma.payment.findFirst({
      where: { provider: "rollypay", orderId },
      select: {
        id: true,
        clientId: true,
        orderId: true,
        externalId: true,
        amount: true,
        currency: true,
      },
    });
    if (!payment) return res.status(200).send("OK");

    await auditPaymentClientBotAlignment(payment);

    const lookup = await getRollypayPayment(paymentId, rollypayConfig);
    if (!lookup.ok) {
      console.warn("[RollyPay Webhook] status lookup failed", {
        paymentId: payment.id,
        providerPaymentId: paymentId,
        kind: lookup.kind,
        status: lookup.status,
        error: lookup.error,
      });
      if (lookup.kind === "transient" || lookup.kind === "not_configured") return res.status(503).send("Retry");
      return res.status(200).send("OK");
    }

    const validation = validateRollypayPayment(payment, webhook, lookup.payment);
    if (!validation.ok) {
      console.warn("[RollyPay Webhook] payment confirmation mismatch", {
        paymentId: payment.id,
        providerPaymentId: paymentId,
        reason: validation.reason,
      });
      return res.status(200).send("OK");
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: { externalId: lookup.payment.payment_id },
    });

    const result = await markPaymentPaid(payment.id);
    if (!result.ok) {
      console.error("[RollyPay Webhook] payment completion failed", {
        paymentId: payment.id,
        error: result.error,
      });
      return res.status(503).send("Retry");
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("[RollyPay Webhook] transient processing failure", error);
    return res.status(503).send("Retry");
  }
});

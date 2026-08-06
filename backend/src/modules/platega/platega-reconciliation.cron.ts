import cron from "node-cron";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { registerCron, wrapCronTick } from "../diagnostics/cron-registry.js";
import { notifyPlategaPaymentEvent } from "../notification/telegram-notify.service.js";
import { completePlategaPayment } from "../webhooks/platega.webhooks.routes.js";
import { getPlategaTransactionStatus, validatePlategaTransaction } from "./platega.service.js";

const NAME = "platega-payment-reconciliation";
const EXPRESSION = "*/2 * * * *";
const SUCCESS = new Set(["CONFIRMED", "PAID", "SUCCESS", "SUCCEEDED", "COMPLETED", "SUCCESSFUL", "APPROVED"]);
const FAILED = new Set(["CANCELED", "CANCELLED", "FAILED", "DECLINED", "REJECTED", "ERROR", "EXPIRED", "CHARGEBACK", "CHARGEBACKED"]);

async function callbackAvailable(publicAppUrl: string | null | undefined): Promise<boolean> {
  const base = publicAppUrl?.trim().replace(/\/+$/, "");
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/webhooks/platega`, { signal: AbortSignal.timeout(8_000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function reconcilePendingPlategaPayments(limit = 10): Promise<{ checked: number; recovered: number; failed: number }> {
  const config = await getSystemConfig();
  const credentials = { merchantId: config.plategaMerchantId?.trim() ?? "", secret: config.plategaSecret?.trim() ?? "" };
  if (!credentials.merchantId || !credentials.secret) return { checked: 0, recovered: 0, failed: 0 };
  const take = Math.max(1, Math.min(25, Math.trunc(limit)));
  const pending = await prisma.payment.findMany({
    where: {
      provider: "platega",
      status: "PENDING",
      externalId: { not: null },
      createdAt: { lte: new Date(Date.now() - 2 * 60_000), gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) },
    },
    orderBy: { createdAt: "asc" },
    take,
    select: { id: true, externalId: true, orderId: true, amount: true, currency: true },
  });
  const paidWithoutActivation = await prisma.payment.findMany({
    where: {
      provider: "platega",
      status: "PAID",
      externalId: { not: null },
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) },
      AND: [
        {
          OR: [
            { tariffId: { not: null } },
            { proxyTariffId: { not: null } },
            { singboxTariffId: { not: null } },
            { metadata: { contains: "\"customBuild\"" } },
            { metadata: { contains: "\"extraOption\"" } },
          ],
        },
        { OR: [{ metadata: null }, { NOT: { metadata: { contains: "\"plategaActivationAppliedAt\"" } } }] },
      ],
    },
    orderBy: { createdAt: "asc" },
    take,
    select: { id: true, externalId: true, orderId: true, amount: true, currency: true },
  });
  const payments = [...pending, ...paidWithoutActivation];
  let recovered = 0;
  let failed = 0;
  for (const payment of payments) {
    if (!payment.externalId) continue;
    const transaction = await getPlategaTransactionStatus(credentials, payment.externalId);
    if ("error" in transaction || validatePlategaTransaction(transaction, payment)) continue;
    const status = transaction.status.toUpperCase();
    if (SUCCESS.has(status)) {
      const result = await completePlategaPayment(payment.id);
      if (result.ok && (result.changed || result.activated)) {
        recovered++;
        await notifyPlategaPaymentEvent({
          kind: "recovered",
          paymentId: payment.id,
          transactionId: payment.externalId,
          details: "Webhook не завершил платёж; статус восстановлен через Platega API",
          callbackAvailable: await callbackAvailable(config.publicAppUrl),
        }).catch(() => {});
      }
    } else if (FAILED.has(status)) {
      const update = await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
      if (update.count) {
        failed++;
        await notifyPlategaPaymentEvent({
          kind: "canceled",
          paymentId: payment.id,
          transactionId: payment.externalId,
          details: `status=${status}; callback не завершил платёж`,
          callbackAvailable: await callbackAvailable(config.publicAppUrl),
        }).catch(() => {});
      }
    }
  }
  return { checked: payments.length, recovered, failed };
}

export function startPlategaReconciliation() {
  let running = false;
  // ponytail: локальный lock рассчитан на один API-процесс; при горизонтальном масштабировании заменить на distributed lock.
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await reconcilePendingPlategaPayments();
    } finally {
      running = false;
    }
  };
  registerCron({ name: NAME, cron: EXPRESSION, description: "Восстановление пропущенных callback Platega", trigger: run });
  cron.schedule(EXPRESSION, wrapCronTick(NAME, run));
}

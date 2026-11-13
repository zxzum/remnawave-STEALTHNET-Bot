import { prisma } from "../../db.js";
import { notifyAdminsAboutError } from "../notification/telegram-notify.service.js";

/**
 * INVOXY-миграция: заблокированный клиент (его панельный пользователь уже принадлежит Invoxy)
 * не должен ни менять панель, ни получать зачисления. Платёж остаётся как есть и помечается
 * metadata.blockedClientHold (+ MANUAL_REVIEW для extra-option) — админ решает вручную (возврат).
 * Возвращает true, если платёж удержан. Админ уведомляется один раз.
 */
export async function holdPaymentIfClientBlocked(paymentId: string): Promise<boolean> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, amount: true, currency: true, status: true, metadata: true, extraOptionState: true, client: { select: { id: true, isBlocked: true, blockReason: true } } },
  });
  if (!payment?.client?.isBlocked) return false;

  let meta: Record<string, unknown> = {};
  try {
    const parsed = payment.metadata ? JSON.parse(payment.metadata) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
  } catch { /* битая metadata не должна ломать удержание */ }
  if (meta.blockedClientHold === true) return true;

  const hasExtraOption = meta.extraOption != null && typeof meta.extraOption === "object";
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      metadata: JSON.stringify({ ...meta, blockedClientHold: true }),
      ...(hasExtraOption && payment.extraOptionState ? { extraOptionState: "MANUAL_REVIEW" as const, extraOptionClaimToken: null, extraOptionNextAttemptAt: null } : {}),
    },
  });
  console.warn("[blocked-client-guard] payment held for manual review", { paymentId: payment.id, clientId: payment.client.id });
  await notifyAdminsAboutError(
    `⚠️ Платёж ${payment.id} (${payment.amount} ${payment.currency}, ${payment.status}) от заблокированного клиента ${payment.client.id} (${payment.client.blockReason ?? "без причины"}). Активация и зачисление пропущены — нужна ручная проверка/возврат.`,
  ).catch(() => {});
  return true;
}

export async function isClientBlocked(clientId: string): Promise<boolean> {
  return Boolean((await prisma.client.findUnique({ where: { id: clientId }, select: { isBlocked: true } }))?.isBlocked);
}

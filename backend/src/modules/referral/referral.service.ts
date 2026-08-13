/**
 * Трёхуровневая реферальная система: начисление процентов от пополнений
 * рефералов уровня 1, 2 и 3 при переходе платежа в статус PAID.
 */

import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { isMailConfigured, mailConfigFromSystem, sendEmail } from "../mail/mail.service.js";
import { sendTelegramToUser } from "../notification/telegram-notify.service.js";
import { buildReferralAccrualNotification } from "./referral-notification.js";

type ReferralAccrualNotification = {
  level: number;
  amount: number;
  balance: number;
  currency: string;
  email: string | null;
  telegramId: string | null;
};

/**
 * Распределяет реферальные бонусы по цепочке рефереров (до 3 уровней)
 * при оплате. Вызывать один раз при переводе платежа в PAID.
 * Идемпотентно: повторный вызов для того же платежа не дублирует начисления
 * (проверка по referralDistributedAt).
 */
export async function distributeReferralRewards(paymentId: string): Promise<{ distributed: boolean; message: string }> {
  const config = await getSystemConfig();
  const p1 = config.defaultReferralPercent;
  const p2 = config.referralPercentLevel2;
  const p3 = config.referralPercentLevel3;

  const transactionResult = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        client: {
          include: {
            referrer: {
              include: {
                referrer: {
                  include: {
                    referrer: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!payment) {
      return { distributed: false, message: "Payment not found", notifications: [] as ReferralAccrualNotification[] };
    }
    if (payment.status !== "PAID") {
      return { distributed: false, message: "Payment is not PAID", notifications: [] as ReferralAccrualNotification[] };
    }
    if (payment.referralDistributedAt != null) {
      return { distributed: false, message: "Referral rewards already distributed for this payment", notifications: [] as ReferralAccrualNotification[] };
    }

    // Claim (идемпотентность при гонках/дублях webhook)
    const claim = await tx.payment.updateMany({
      where: { id: paymentId, status: "PAID", referralDistributedAt: null },
      data: { referralDistributedAt: new Date() },
    });
    if (claim.count === 0) {
      return { distributed: false, message: "Referral rewards already distributed for this payment", notifications: [] as ReferralAccrualNotification[] };
    }

    const level1 = payment.client.referrer ?? null;
    const level2 = level1?.referrer ?? null;
    const level3 = level2?.referrer ?? null;

    // v5.0.0: после выпила multi-bot реферальный бонус считается от amount
    // (раньше использовалось baseAmount = amount без наценки клона).
    const amount = payment.amount;
    const updates: { clientId: string; email: string | null; telegramId: string | null; bonus: number; level: number }[] = [];
    // ВНИМАНИЕ: Client.referralPercent — это индивидуальный override клиента
    // как реферера ПЕРВОГО уровня (т.е. процент с его прямых рефералов).
    // Для 2/3 уровня этот override НЕ применяется — там всегда глобальный
    // дефолт из SystemConfig.referralPercentLevel2 / referralPercentLevel3.
    // Раньше тут было `level2?.referralPercent ?? p2` — это давало бонус
    // 2 уровня по проценту 1-го уровня (если у промежуточного реферера
    // стоял VIP-override). См. отчёт пользователя 14.05.2026.
    const pct1 = level1?.referralPercent ?? p1;
    const pct2 = p2;
    const pct3 = p3;
    if (level1 && !level1.isBlocked && pct1 > 0) {
      updates.push({ clientId: level1.id, email: level1.email, telegramId: level1.telegramId, bonus: Math.round(amount * (pct1 / 100) * 100) / 100, level: 1 });
    }
    if (level2 && !level2.isBlocked && pct2 > 0) {
      updates.push({ clientId: level2.id, email: level2.email, telegramId: level2.telegramId, bonus: Math.round(amount * (pct2 / 100) * 100) / 100, level: 2 });
    }
    if (level3 && !level3.isBlocked && pct3 > 0) {
      updates.push({ clientId: level3.id, email: level3.email, telegramId: level3.telegramId, bonus: Math.round(amount * (pct3 / 100) * 100) / 100, level: 3 });
    }

    const notifications: ReferralAccrualNotification[] = [];
    for (const { clientId, email, telegramId, bonus, level } of updates) {
      const client = await tx.client.update({
        where: { id: clientId },
        data: { balance: { increment: bonus } },
        select: { balance: true },
      });
      await tx.referralCredit.create({
        data: { referrerId: clientId, paymentId, amount: bonus, level },
      });
      notifications.push({ level, amount: bonus, balance: client.balance, currency: payment.currency, email, telegramId });
    }

    if (updates.length === 0) {
      return { distributed: true, message: "No referrers or all blocked; payment marked as distributed", notifications };
    }

    return {
      distributed: true,
      message: `Distributed to ${updates.length} referrer(s)`,
      notifications,
    };
  });

  const { notifications, ...result } = transactionResult;
  const mailConfig = mailConfigFromSystem(config);
  const deliveries: Promise<unknown>[] = [];
  for (const accrual of notifications) {
    const rendered = buildReferralAccrualNotification(accrual);
    if (accrual.telegramId) {
      deliveries.push(sendTelegramToUser(accrual.telegramId, rendered.text));
    }
    if (accrual.email && isMailConfigured(mailConfig)) {
      deliveries.push(sendEmail(mailConfig, accrual.email, rendered.subject, rendered.html).then((delivery) => {
        if (!delivery.ok) console.warn("[Referral notify] email failed", delivery.error);
      }));
    }
  }
  await Promise.allSettled(deliveries);
  return result;
}

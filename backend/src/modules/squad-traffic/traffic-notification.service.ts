import { prisma } from "../../db.js";
import { sendTelegramToUser } from "../notification/telegram-notify.service.js";
import { effectiveLimitBytes } from "./traffic-period.js";

const MILESTONE_ORDER = [50, 25, 10, 3, 0];

function formatTraffic(bytes: bigint): string {
  for (const [unit, label] of [[1024n ** 3n, "ГБ"], [1024n ** 2n, "МБ"], [1024n, "КБ"]] as const) {
    if (bytes >= unit) {
      const tenths = (bytes * 10n + unit / 2n) / unit;
      return `${tenths / 10n}.${tenths % 10n} ${label}`;
    }
  }
  return `${bytes} Б`;
}

export type TrafficNotificationDependencies = {
  prisma: {
    squadTrafficQuota: { findUnique: (args: any) => Promise<any>; updateMany: (args: any) => Promise<{ count: number }> };
    trafficQuotaEvent: { create: (args: any) => Promise<unknown> };
  };
  sendTelegramToUser: typeof sendTelegramToUser;
};

const defaultDependencies: TrafficNotificationDependencies = { prisma, sendTelegramToUser };

function milestoneText(percent: number, quota: any, limitBytes: bigint): string {
  const remaining = limitBytes > quota.usedBytes ? limitBytes - quota.usedBytes : 0n;
  const usage = `Использовано: ${formatTraffic(quota.usedBytes)} из ${formatTraffic(limitBytes)}`;
  if (percent === 0) {
    return `⛔ Трафик закончился\n\n${usage}\nПродлите тариф или добавьте трафик.`;
  }
  const icon = percent <= 3 ? "🚨" : percent <= 10 ? "⚠️" : "📶";
  return `${icon} Осталось ${percent}% трафика\n\n${usage}\nОсталось: ${formatTraffic(remaining)}`;
}

/**
 * Reserves every milestone atomically before sending. Failed sends remain reserved
 * so a worker restart cannot create a duplicate-notification storm.
 */
export async function notifyTrafficMilestones(
  subscriptionId: string,
  percents: number[],
  dependencies: TrafficNotificationDependencies = defaultDependencies,
): Promise<{ sent: number; skipped: number; failed: number }> {
  const quota = await dependencies.prisma.squadTrafficQuota.findUnique({
    where: { subscriptionId },
    include: { grants: true, subscription: { include: { owner: true } } },
  });
  if (!quota) return { sent: 0, skipped: 0, failed: 0 };

  const limitBytes = effectiveLimitBytes(
    quota.baseLimitBytes,
    (quota.grants ?? []).filter((grant: { status: string }) => grant.status === "ACTIVE"),
    quota.tariffIdAtPeriodStart,
    quota.periodStartedAt,
  );
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const requested = new Set(percents);

  for (const percent of MILESTONE_ORDER) {
    if (!requested.has(percent)) continue;
    const reservation = await dependencies.prisma.squadTrafficQuota.updateMany({
      where: { id: quota.id, NOT: { notifiedPercents: { has: percent } } },
      data: { notifiedPercents: { push: percent } },
    });
    if (reservation.count !== 1) continue;

    const eventBase = {
      quotaId: quota.id,
      usedBytes: quota.usedBytes,
      limitBytes,
      detail: { percent },
    };
    const telegramId = quota.subscription?.owner?.telegramId?.trim();
    if (!telegramId) {
      await dependencies.prisma.trafficQuotaEvent.create({
        data: { ...eventBase, kind: "NOTIFICATION_SKIPPED_NO_TELEGRAM" },
      });
      skipped++;
      continue;
    }

    try {
      await dependencies.sendTelegramToUser(
        telegramId,
        milestoneText(percent, quota, limitBytes),
        undefined,
        { inline_keyboard: [[{ text: "➕ Докупить трафик", callback_data: "menu:extra_options" }]] },
      );
      sent++;
    } catch (error) {
      await dependencies.prisma.trafficQuotaEvent.create({
        data: {
          ...eventBase,
          kind: "NOTIFICATION_FAILED",
          detail: { percent, error: error instanceof Error ? error.message : String(error) },
        },
      });
      failed++;
    }
  }

  return { sent, skipped, failed };
}

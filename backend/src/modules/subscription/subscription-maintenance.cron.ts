import cron from "node-cron";
import { prisma } from "../../db.js";
import { registerCron, wrapCronTick } from "../diagnostics/cron-registry.js";
import {
  deleteSingleSubscription,
  processExpiredSingleSubscriptionAccess,
} from "./single-subscription-lifecycle.service.js";
import { drainPaidExtraOptionQueue } from "../extra-options/extra-options.service.js";
import {
  DEFAULT_SUBSCRIPTION_EXPIRY_TEXT,
  DEFAULT_TRIAL_EXPIRY_TEXT,
  notifySubscriptionExpiry,
  notifyTrialExpiry,
  sendTelegramToUser,
} from "../notification/telegram-notify.service.js";
import { sendExpiryReminderEmail } from "../notification/expiry-email-notify.service.js";
import { getSystemConfig } from "../client/client.service.js";
import { isMailConfigured, mailConfigFromSystem } from "../mail/mail.service.js";

const NAME = "subscription-expiry-and-deletion-maintenance";
const EXPRESSION = "*/5 * * * *";

export function parseReminderHours(value: string, fallback = "3, 0.5"): number[] {
  const parse = (source: string) => [...new Set(source.split(",")
    .map(Number)
    .filter((hours) => Number.isFinite(hours) && hours >= 5 / 60 && hours <= 24 * 365)
    .map((hours) => Math.round(hours * 60)))].sort((a, b) => b - a);
  const parsed = parse(value);
  return parsed.length ? parsed : parse(fallback);
}

export function expiryReminderOffset(expireAt: Date, now = new Date(), offsets = [180, 30]): number | null {
  const minutesLeft = Math.floor((expireAt.getTime() - now.getTime()) / 60_000);
  if (minutesLeft <= 0) return null;
  // Ближайший (наименьший) offset >= оставшегося времени.
  // Раньше было окно (offset-5, offset], ровно под тик раз в 5 минут: любой пропущенный
  // или задержанный тик (рестарт API, долгий expiry-шаг перед уведомлениями) терял
  // напоминание навсегда. Дедуп по expiryReminderKey гарантирует однократную отправку
  // каждого offset'а, а пропущенное окно догоняется на следующем тике.
  return offsets.filter((offset) => minutesLeft <= offset).sort((a, b) => a - b)[0] ?? null;
}

export function expiringSubscriptionKind(subscription: {
  trialId: string | null;
  tariffId: string | null;
  owner: { trialUsed: boolean };
}): "trial" | "paid" | null {
  if (subscription.trialId || (!subscription.tariffId && subscription.owner.trialUsed)) return "trial";
  return subscription.tariffId ? "paid" : null;
}

export function expiryReminderKey(
  channel: "telegram" | "email",
  kind: "trial" | "paid",
  offset: number,
  expireAt: Date,
): string {
  return `${channel}:${kind}-expiry:${offset}:${expireAt.toISOString()}`;
}

const ONBOARDING_REMINDER_DELAYS_MS = [15 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

export function onboardingReminderDue(client: {
  createdAt: Date;
  onboardingReminderCount: number;
  onboardingLastRemindedAt: Date | null;
}, now = new Date()): boolean {
  const delay = ONBOARDING_REMINDER_DELAYS_MS[client.onboardingReminderCount];
  if (delay == null) return false;
  const since = client.onboardingLastRemindedAt ?? client.createdAt;
  return now.getTime() - since.getTime() >= delay;
}

export async function notifyIncompleteOnboarding(now = new Date()): Promise<number> {
  const clients = await prisma.client.findMany({
    where: {
      onboardingCompleted: false,
      onboardingReminderCount: { lt: ONBOARDING_REMINDER_DELAYS_MS.length },
      telegramId: { not: null },
      isBlocked: false,
      telegramUnreachable: false,
      ownedSubscriptions: { some: { deletionRequestedAt: null } },
    },
    select: {
      id: true,
      telegramId: true,
      createdAt: true,
      onboardingReminderCount: true,
      onboardingLastRemindedAt: true,
    },
  });
  const texts = [
    "🔔 Привет!\n\nНачни настройку Лазейка VPN сейчас — доступ уже активирован. Это займёт около минуты 👇",
    "⚠️ Мы активировали твой пробный доступ, но настройка ещё не закончена.\n\nУстанови приложение и подключись по кнопке ниже 👇",
    "🟨 Привет!\n\nПохоже, ты ещё не успел(-а) попробовать Лазейка VPN. Подключись, чтобы получить доступ к любимым сервисам — это займёт минуту 👇",
  ];
  let sent = 0;
  for (const client of clients) {
    if (!client.telegramId || !onboardingReminderDue(client, now)) continue;
    const claimed = await prisma.client.updateMany({
      where: {
        id: client.id,
        onboardingCompleted: false,
        onboardingReminderCount: client.onboardingReminderCount,
      },
      data: {
        onboardingReminderCount: { increment: 1 },
        onboardingLastRemindedAt: now,
      },
    });
    if (!claimed.count) continue;
    // Пользователь мог нажать «Готово» между выборкой и захватом напоминания.
    // Не отправляем устаревшее сообщение, если настройка уже завершена.
    const stillIncomplete = await prisma.client.findFirst({
      where: { id: client.id, onboardingCompleted: false },
      select: { id: true },
    });
    if (!stillIncomplete) continue;
    await sendTelegramToUser(client.telegramId, texts[client.onboardingReminderCount]!, null, {
      inline_keyboard: [[{ text: "🛡 Перейти к настройке", callback_data: "setup:resume" }]],
    }, { clientIdForBotToken: client.id });
    sent++;
  }
  return sent;
}

export async function notifyExpiringSubscriptions(now = new Date()): Promise<number> {
  const config = await getSystemConfig();
  const trialOffsets = config.trialExpiryReminderEnabled
    ? parseReminderHours(config.trialExpiryReminderHours)
    : [];
  const paidOffsets = config.subscriptionExpiryReminderEnabled
    ? parseReminderHours(config.subscriptionExpiryReminderHours)
    : [];
  const emailConfigured = Boolean(
    (config.publicAppUrl ?? "").trim()
    && isMailConfigured(mailConfigFromSystem(config)),
  );
  const trialEmailOffsets = emailConfigured && config.trialExpiryEmailReminderEnabled
    ? parseReminderHours(config.trialExpiryEmailReminderHours, "24")
    : [];
  const paidEmailOffsets = emailConfigured && config.subscriptionExpiryEmailReminderEnabled
    ? parseReminderHours(config.subscriptionExpiryEmailReminderHours, "24")
    : [];
  const maxOffset = Math.max(0, ...trialOffsets, ...paidOffsets, ...trialEmailOffsets, ...paidEmailOffsets);
  if (!maxOffset) return 0;
  const subscriptions = await prisma.subscription.findMany({
    where: {
      deletionRequestedAt: null,
      purchasedAsGift: false,
      expireAt: { gt: now, lte: new Date(now.getTime() + maxOffset * 60_000) },
      owner: { OR: [{ telegramId: { not: null } }, { email: { not: null } }] },
    },
    select: {
      id: true,
      expireAt: true,
      trialId: true,
      tariffId: true,
      trial: { select: { name: true } },
      tariff: { select: { name: true } },
      owner: { select: { telegramId: true, email: true, trialUsed: true } },
    },
  });
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      sent += await processExpiringSubscription(subscription, now, {
        trialOffsets,
        paidOffsets,
        trialEmailOffsets,
        paidEmailOffsets,
        config,
      });
    } catch (error) {
      // Одна битая подписка/сбой отправки не должны ронять весь проход —
      // иначе напоминания не уходят никому.
      console.warn("[expiry reminder] subscription processing failed", {
        subscriptionId: subscription.id,
        error: String(error),
      });
    }
  }
  return sent;
}

async function processExpiringSubscription(
  subscription: {
    id: string;
    expireAt: Date | null;
    trialId: string | null;
    tariffId: string | null;
    trial: { name: string } | null;
    tariff: { name: string } | null;
    owner: { telegramId: string | null; email: string | null; trialUsed: boolean };
  },
  now: Date,
  ctx: {
    trialOffsets: number[];
    paidOffsets: number[];
    trialEmailOffsets: number[];
    paidEmailOffsets: number[];
    config: Awaited<ReturnType<typeof getSystemConfig>>;
  },
): Promise<number> {
  const { trialOffsets, paidOffsets, trialEmailOffsets, paidEmailOffsets, config } = ctx;
  let sent = 0;
  {
    if (!subscription.expireAt) return 0;
    const kind = expiringSubscriptionKind(subscription);
    if (!kind) return 0;
    // Реальный остаток — для текста «закончится через {{time}}», даже когда
    // напоминание догоняет пропущенное окно.
    const minutesLeftActual = Math.max(1, Math.floor((subscription.expireAt.getTime() - now.getTime()) / 60_000));

    const displayName = kind === "trial"
      ? subscription.trial?.name ?? subscription.tariff?.name ?? "Пробный период"
      : subscription.tariff?.name ?? "Подписка";
    const telegramOffset = subscription.owner.telegramId
      ? expiryReminderOffset(subscription.expireAt, now, kind === "trial" ? trialOffsets : paidOffsets)
      : null;
    if (telegramOffset && subscription.owner.telegramId) {
      const key = expiryReminderKey("telegram", kind, telegramOffset, subscription.expireAt);
      const claimed = await prisma.subscription.updateMany({
        where: { id: subscription.id, NOT: { expiryReminderKey: key } },
        data: { expiryReminderKey: key },
      });
      if (claimed.count > 0) {
        const delivered = kind === "trial"
          ? await notifyTrialExpiry(
            subscription.owner.telegramId,
            displayName,
            minutesLeftActual,
            config.trialExpiryReminderText ?? DEFAULT_TRIAL_EXPIRY_TEXT,
            config.trialExpiryReminderButtonText,
          )
          : await notifySubscriptionExpiry(
            subscription.owner.telegramId,
            subscription.id,
            displayName,
            minutesLeftActual,
            config.subscriptionExpiryReminderText ?? DEFAULT_SUBSCRIPTION_EXPIRY_TEXT,
            config.subscriptionExpiryReminderButtonText,
          );
        if (delivered) sent++;
        else {
          await prisma.subscription.updateMany({
            where: { id: subscription.id, expiryReminderKey: key },
            data: { expiryReminderKey: null },
          });
        }
      }
    }

    const emailOffset = subscription.owner.email
      ? expiryReminderOffset(subscription.expireAt, now, kind === "trial" ? trialEmailOffsets : paidEmailOffsets)
      : null;
    if (emailOffset && subscription.owner.email) {
      const key = expiryReminderKey("email", kind, emailOffset, subscription.expireAt);
      const claimed = await prisma.subscription.updateMany({
        where: { id: subscription.id, NOT: { expiryEmailReminderKey: key } },
        data: { expiryEmailReminderKey: key },
      });
      if (claimed.count > 0) {
        const delivered = await sendExpiryReminderEmail(
          config,
          kind === "trial" ? "trial" : "subscription",
          subscription.owner.email,
          displayName,
          emailOffset,
        );
        if (delivered) {
          sent++;
        } else {
          await prisma.subscription.updateMany({
            where: { id: subscription.id, expiryEmailReminderKey: key },
            data: { expiryEmailReminderKey: null },
          });
        }
      }
    }
  }
  return sent;
}

export async function retryPendingSubscriptionDeletions(
  limit = 50,
  remove: (subscriptionId: string, operation: "DELETE" | "REVOKE") => Promise<{ deleted: boolean }> = deleteSingleSubscription,
) {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      deletionRequestedAt: { not: null },
      deletionOperation: { in: ["DELETE", "REVOKE"] },
      syncStatus: "PENDING",
      syncRequiredAt: { lte: new Date() },
    },
    orderBy: { syncRequiredAt: "asc" },
    take: Math.max(1, Math.min(200, Math.trunc(limit))),
    select: { id: true, deletionOperation: true },
  });
  let deleted = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    if (subscription.deletionOperation !== "DELETE" && subscription.deletionOperation !== "REVOKE") continue;
    try {
      const result = await remove(subscription.id, subscription.deletionOperation);
      if (result.deleted) deleted++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { deleted, failed };
}

export async function runSubscriptionMaintenance(
  expiry: (limit: number) => Promise<{ checked: number; grace: number; disabled: number; failed: number }>
    = processExpiredSingleSubscriptionAccess,
  deletions: (limit: number) => Promise<{ deleted: number; failed: number }>
    = retryPendingSubscriptionDeletions,
  extraOptions: (limit: number) => Promise<{ checked: number; applied: number; queued: number; failed: number }>
    = drainPaidExtraOptionQueue,
  expiryNotifications: (now: Date) => Promise<number> = notifyExpiringSubscriptions,
  onboardingNotifications: (now: Date) => Promise<number> = notifyIncompleteOnboarding,
) {
  const now = new Date();
  // Каждый шаг изолирован: падение одного (например, недоступный Remnawave в expiry)
  // не должно блокировать остальные — раньше исключение в первом шаге обрывало тик
  // и напоминания о продлении не отправлялись вообще.
  const guarded = <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> =>
    fn().catch((error: unknown) => {
      console.warn(`[subscription-maintenance] step "${label}" failed`, error);
      return fallback;
    });
  return {
    expiry: await guarded("expiry", () => expiry(200), { checked: 0, grace: 0, disabled: 0, failed: 0 }),
    deletions: await guarded("deletions", () => deletions(50), { deleted: 0, failed: 0 }),
    extraOptions: await guarded("extraOptions", () => extraOptions(50), { checked: 0, applied: 0, queued: 0, failed: 0 }),
    expiryNotifications: await guarded("expiryNotifications", () => expiryNotifications(new Date()), 0),
    onboardingNotifications: await guarded("onboardingNotifications", () => onboardingNotifications(new Date()), 0),
  };
}

export function startSubscriptionMaintenance() {
  const run = () => runSubscriptionMaintenance();
  registerCron({
    name: NAME,
    cron: EXPRESSION,
    description: "Grace/expiry, retry удаления и очередь оплаченных опций",
    trigger: run,
  });
  cron.schedule(EXPRESSION, wrapCronTick(NAME, run));
}

import { prisma } from "../../db.js";
import {
  remnaDeleteUser,
  remnaDisableUser,
  remnaEnableUser,
  remnaRevokeUserSubscription,
  remnaUpdateUser,
} from "../remna/remna.client.js";
import { notifySubscriptionRevoked } from "../notification/telegram-notify.service.js";
import { getSystemConfig } from "../client/client.service.js";
import { remnaTrafficSettings } from "../squad-traffic/traffic-remna-policy.js";

type RemnaResult = { data?: unknown; error?: string; status: number };
type RemnaRequest = (uuid: string) => Promise<RemnaResult>;
type RemnaUpdateRequest = (body: Record<string, unknown>) => Promise<RemnaResult>;
type Failure = { key: "subscription"; required: true; error: string };
type ExpiredGraceConfig = {
  expiredGraceEnabled: boolean;
  expiredGraceDays: number;
  expiredGraceSquadUuid: string | null;
};

export type SingleSubscriptionOperationResult = {
  failures: Failure[];
  requiredFailure: boolean;
};

export function isActiveSubscriptionGrace(graceUntil: Date | null, now = new Date()): boolean {
  return graceUntil != null && graceUntil.getTime() > now.getTime();
}

/**
 * Гейт выдачи Lazeika-Only grace. По умолчанию выводится из legacy expired_grace_*,
 * cron передаёт реальный loader с проверкой READY-инфраструктуры.
 */
export type LazeikaGate = { enabled: boolean; days: number; squadUuid: string | null; ready: boolean };

function legacyGateFromConfig(config: ExpiredGraceConfig): LazeikaGate {
  return {
    enabled: config.expiredGraceEnabled,
    days: Math.max(0, Math.trunc(config.expiredGraceDays)),
    squadUuid: config.expiredGraceSquadUuid,
    // ponytail: в legacy-режиме инфраструктурой считается сам squad.
    ready: Boolean(config.expiredGraceSquadUuid),
  };
}

/**
 * Тот же advisory-ключ, что у оплаты (withClientSubscriptionLock в tariff-activation):
 * cron и активация платежа не могут одновременно мутатить одну подписку (§4.4 race).
 * Отдельная функция, а не импорт из tariff-activation — там импортируется этот модуль.
 */
export async function withSubscriptionClientLock<T>(clientId: string, fn: () => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientId}))`;
    return fn();
  });
}

export async function requireSubscriptionRemnaUuid(subscriptionId: string): Promise<string> {
  const row = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: { remnawaveUuid: true },
  });
  if (!row?.remnawaveUuid) throw new Error("Подписка не привязана к Remnawave");
  return row.remnawaveUuid;
}

async function recordFailure(subscriptionId: string, error: string) {
  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      syncStatus: "PENDING",
      syncAttempts: { increment: 1 },
      syncError: error,
      syncRequiredAt: new Date(Date.now() + 5 * 60_000),
    },
  });
}

export async function runSingleSubscriptionOperation(
  subscriptionId: string,
  request: RemnaRequest,
): Promise<SingleSubscriptionOperationResult> {
  try {
    const response = await request(await requireSubscriptionRemnaUuid(subscriptionId));
    if (response.error) throw new Error(response.error);
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { syncStatus: "SYNCED", syncAttempts: 0, syncError: null, syncRequiredAt: null },
    });
    return { failures: [], requiredFailure: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordFailure(subscriptionId, message);
    return { failures: [{ key: "subscription", required: true, error: message }], requiredFailure: true };
  }
}

export function enableSingleSubscription(
  subscriptionId: string,
  request: RemnaRequest = remnaEnableUser,
) {
  return runSingleSubscriptionOperation(subscriptionId, request);
}

export function disableSingleSubscription(
  subscriptionId: string,
  request: RemnaRequest = remnaDisableUser,
) {
  return runSingleSubscriptionOperation(subscriptionId, request);
}

export function revokeSingleSubscription(
  subscriptionId: string,
  request: RemnaRequest = remnaRevokeUserSubscription,
) {
  return runSingleSubscriptionOperation(subscriptionId, request);
}

export async function processExpiredSingleSubscriptionAccess(
  limit = 200,
  request: RemnaUpdateRequest = remnaUpdateUser,
  configLoader: () => Promise<ExpiredGraceConfig> = getSystemConfig,
  now = new Date(),
  /** Реальный cron передаёт loader с проверкой READY; тесты/legacy используют дефолт. */
  lazeikaGateLoader: (config: ExpiredGraceConfig) => Promise<LazeikaGate> = async (config) =>
    legacyGateFromConfig(config),
  /** Инъекция для тестов; прод — advisory-лок по клиенту (общий с оплатой). */
  lock: <T>(clientId: string, fn: () => Promise<T>) => Promise<T> = withSubscriptionClientLock,
) {
  const config = await configLoader();
  const lazeika = await lazeikaGateLoader(config);
  const subscriptions = await prisma.subscription.findMany({
    where: { expireAt: { lte: now }, deletionRequestedAt: null },
    orderBy: { expireAt: "desc" },
    take: Math.max(1, Math.min(1000, Math.trunc(limit))),
    select: {
      id: true,
      ownerId: true,
      remnawaveUuid: true,
      expireAt: true,
      graceUntil: true,
      extraDevices: true,
      tariffId: true,
      tariff: {
        select: {
          trafficLimitBytes: true,
          trafficLimitMode: true,
          trafficResetMode: true,
          includedDevices: true,
          internalSquadUuids: true,
        },
      },
    },
  });

  /** Обработка одной истёкшей строки под клиентским локом (§4.4 race). */
  const processRow = async (
    subscription: (typeof subscriptions)[number],
  ): Promise<"GRACE" | "DISABLED" | "FAILED"> => {
    const expireAt = subscription.expireAt;
    if (!expireAt) return "DISABLED";
    const graceActiveBefore = isActiveSubscriptionGrace(subscription.graceUntil, now);
    const graceElapsed = subscription.graceUntil != null && !graceActiveBefore;

    // Fixed graceUntil: уже выданный доступ не пересчитывается при каждом запуске (§4.1.4).
    // НО: если функция выключена/инфраструктура не готова — активный grace закрывается
    // ближайшим тиком (§4.4 disable, state-diagram GRACE_ACTIVE → DISABLED).
    let desiredGraceUntil: Date | null = null;
    const graceStillAllowed = Boolean(lazeika.enabled && lazeika.ready && lazeika.squadUuid && lazeika.days > 0);
    if (graceActiveBefore && graceStillAllowed) {
      desiredGraceUntil = subscription.graceUntil;
    } else if (!graceElapsed) {
      const computed = new Date(expireAt.getTime() + Math.max(0, lazeika.days) * 86_400_000);
      const allowFreshEntry = Boolean(
        lazeika.enabled
        && lazeika.ready
        && lazeika.squadUuid
        && lazeika.days > 0
        && now.getTime() < computed.getTime(),
      );
      desiredGraceUntil = allowFreshEntry ? computed : null;
    }
    const enteringGrace = desiredGraceUntil != null;

    // Remna update ПЕРВЫЙ: graceUntil не записывается до успешного ответа (§4.1.6).
    const result = await runSingleSubscriptionOperation(subscription.id, (uuid) => request({
      uuid,
      expireAt: (enteringGrace ? desiredGraceUntil! : expireAt).toISOString(),
      status: enteringGrace ? "ACTIVE" : "DISABLED",
      ...(enteringGrace ? {
        // Grace: трафик NO_RESET/0 (§4.1.5), HWID сохраняем.
        trafficLimitBytes: 0,
        trafficLimitStrategy: "NO_RESET",
        hwidDeviceLimit: subscription.tariff
          ? Math.max(1, subscription.tariff.includedDevices + subscription.extraDevices)
          : undefined,
        activeInternalSquads: [lazeika.squadUuid],
      } : subscription.tariff && subscription.graceUntil == null ? {
        // Обычное истечение без grace — прежнее поведение.
        ...remnaTrafficSettings(subscription.tariff),
        hwidDeviceLimit: Math.max(1, subscription.tariff.includedDevices + subscription.extraDevices),
        activeInternalSquads: subscription.tariff.internalSquadUuids,
      } : {
        // Grace-подписка теряет доступ (истёк §4.2 ИЛИ функция выключена §4.4):
        // рабочий тарифный squad не оставляем.
        ...(subscription.tariff
          ? { hwidDeviceLimit: Math.max(1, subscription.tariff.includedDevices + subscription.extraDevices) }
          : {}),
        activeInternalSquads: [],
      }),
    }));
    if (result.requiredFailure) return "FAILED";
    // Успех: фиксируем/очищаем graceUntil локально.
    if (subscription.graceUntil?.getTime() !== desiredGraceUntil?.getTime()) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { graceUntil: desiredGraceUntil },
      });
    }
    return enteringGrace ? "GRACE" : "DISABLED";
  };

  let grace = 0;
  let disabled = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    if (!subscription.expireAt) continue;
    const outcome = await lock(subscription.ownerId, async () => {
      // Перечитываем ПОД локом: параллельная оплата могла изменить строку между
      // выборкой и PATCH — тогда этот тик её не трогает (§4.4 race).
      const fresh = await prisma.subscription.findUnique({
        where: { id: subscription.id },
        select: { remnawaveUuid: true, expireAt: true, graceUntil: true, deletionRequestedAt: true, extraDevices: true, tariffId: true },
      });
      const unchanged = fresh
        && !fresh.deletionRequestedAt
        && fresh.expireAt?.getTime() === subscription.expireAt?.getTime()
        && (fresh.graceUntil?.getTime() ?? null) === (subscription.graceUntil?.getTime() ?? null)
        && fresh.extraDevices === subscription.extraDevices
        && (fresh.tariffId ?? null) === (subscription.tariffId ?? null);
      if (!unchanged) return "CHANGED" as const;
      return processRow(subscription);
    });
    if (outcome === "CHANGED") continue;
    if (outcome === "FAILED") failed++;
    else if (outcome === "GRACE") grace++;
    else disabled++;
  }
  return { checked: subscriptions.length, grace, disabled, failed };
}

async function completeSubscriptionDeletion(
  subscriptionId: string,
  links: { ownerId: string; subscriptionIndex: number },
) {
  await prisma.$transaction(async (tx) => {
    await tx.subscription.delete({
      where: { id: subscriptionId },
    });
    const isPrimary = links.subscriptionIndex === 0;
    if (!isPrimary) return;

    const replacement = await tx.subscription.findFirst({
      where: {
        ownerId: links.ownerId,
        subscriptionIndex: { gt: 0 },
        deletionRequestedAt: null,
        purchasedAsGift: false,
        giftStatus: null,
        giftedToClientId: null,
        remnawaveUuid: { not: null },
      },
      orderBy: { subscriptionIndex: "asc" },
      select: {
        id: true,
        remnawaveUuid: true,
        tariffId: true,
        customPrice: true,
        currentPricePerDay: true,
        autoRenewEnabled: true,
        autoRenewTariffId: true,
        autoRenewPriceOptionId: true,
        extraDevices: true,
        autoRenewPromoCode: true,
      },
    });

    if (replacement) {
      await tx.subscription.update({
        where: { id: replacement.id },
        data: { subscriptionIndex: 0 },
      });
      await tx.client.update({
        where: { id: links.ownerId },
        data: {
          remnawaveUuid: replacement.remnawaveUuid,
          currentTariffId: replacement.tariffId,
          currentPricePerDay: replacement.currentPricePerDay,
          customPrimaryPrice: replacement.customPrice,
          autoRenewEnabled: replacement.autoRenewEnabled,
          autoRenewTariffId: replacement.autoRenewTariffId,
          autoRenewPriceOptionId: replacement.autoRenewPriceOptionId,
          autoRenewExtraDevices: replacement.extraDevices,
          autoRenewRetryCount: 0,
          autoRenewNotifiedAt: null,
          autoRenewPromoCode: replacement.autoRenewPromoCode,
          lastArnNotifiedKey: null,
        },
      });
      return;
    }

    await tx.client.update({
      where: { id: links.ownerId },
      data: {
        remnawaveUuid: null,
        currentTariffId: null,
        currentPricePerDay: null,
        customPrimaryPrice: null,
        autoRenewEnabled: false,
        autoRenewTariffId: null,
        autoRenewPriceOptionId: null,
        autoRenewExtraDevices: 0,
        autoRenewRetryCount: 0,
        autoRenewNotifiedAt: null,
        autoRenewPromoCode: null,
        lastArnNotifiedKey: null,
      },
    });
  });
}

function notifyRevoked(subscriptionId: string, links: { ownerId: string; subscriptionIndex: number }) {
  void notifySubscriptionRevoked({
    clientId: links.ownerId,
    subscriptionId,
    subscriptionIndex: links.subscriptionIndex,
  }).catch((error) => console.warn("[subscription revoke] notification failed", error));
}

export async function deleteSingleSubscription(
  subscriptionId: string,
  deletionOperation: "DELETE" | "REVOKE" = "DELETE",
  request: RemnaRequest = remnaDeleteUser,
) {
  const marked = await prisma.subscription.updateMany({
    where: { id: subscriptionId },
    data: {
      deletionRequestedAt: new Date(),
      deletionOperation,
      autoRenewEnabled: false,
      syncStatus: "PENDING",
      syncRequiredAt: new Date(),
    },
  });
  if (!marked.count) return { deleted: true, failures: [] as Failure[], requiredFailure: false };

  const links = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: { ownerId: true, subscriptionIndex: true, remnawaveUuid: true },
  });
  if (!links) return { deleted: true, failures: [] as Failure[], requiredFailure: false };
  if (!links.remnawaveUuid) {
    await completeSubscriptionDeletion(subscriptionId, links);
    if (deletionOperation === "REVOKE") notifyRevoked(subscriptionId, links);
    return { deleted: true, failures: [] as Failure[], requiredFailure: false };
  }

  let response: RemnaResult;
  try {
    response = await request(links.remnawaveUuid);
  } catch (error) {
    response = { status: 0, error: error instanceof Error ? error.message : String(error) };
  }
  if (response.error && response.status !== 404) {
    await recordFailure(subscriptionId, response.error);
    const failures: Failure[] = [{ key: "subscription", required: true, error: response.error }];
    return { deleted: false, failures, requiredFailure: true };
  }
  await completeSubscriptionDeletion(subscriptionId, links);
  if (deletionOperation === "REVOKE") notifyRevoked(subscriptionId, links);
  return { deleted: true, failures: [] as Failure[], requiredFailure: false };
}

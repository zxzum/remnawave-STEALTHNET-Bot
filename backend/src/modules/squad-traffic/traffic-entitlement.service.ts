import type { Prisma } from "@prisma/client";

import { prisma } from "../../db.js";
import { remnaUpdateUser } from "../remna/remna.client.js";
import { effectiveLimitBytes, nextMonthlyBoundary } from "./traffic-period.js";

export type TrafficEntitlementInput = {
  tariffId: string | null;
  mode: "REMNAWAVE" | "LOCAL_SQUAD";
  internalSquadUuids: string[];
  meteredSquadUuid: string | null;
  trafficLimitBytes: bigint | null;
};

export type TrafficEntitlementReason = "NEW_PURCHASE" | "RENEWAL" | "TARIFF_CHANGE" | "TRIAL_ACTIVATION";

export type TrafficEntitlementDependencies = {
  prisma: typeof prisma;
  updateRemnaUser: typeof remnaUpdateUser;
};

const defaultDependencies: TrafficEntitlementDependencies = {
  prisma,
  updateRemnaUser: remnaUpdateUser,
};

export function validateTrafficEntitlement(input: TrafficEntitlementInput): TrafficEntitlementInput {
  if (input.mode === "LOCAL_SQUAD"
    && (!input.meteredSquadUuid || !input.internalSquadUuids.includes(input.meteredSquadUuid))) {
    throw new Error("Выберите учитываемый squad из назначенных");
  }
  return input;
}

function activeGrants<T extends { status: string }>(grants: T[]): T[] {
  return grants.filter((grant) => grant.status === "ACTIVE");
}

async function writeEvent(
  tx: Prisma.TransactionClient,
  data: {
    quotaId: string;
    kind: string;
    deltaBytes?: bigint;
    usedBytes: bigint;
    limitBytes: bigint;
    detail?: Prisma.InputJsonValue;
  },
) {
  return tx.trafficQuotaEvent.create({ data });
}

async function rolloverInTransaction(
  tx: Prisma.TransactionClient,
  quota: {
    id: string;
    tariffIdAtPeriodStart: string | null;
    baseLimitBytes: bigint;
    periodEndsAt: Date;
    grants: Array<{
      bytes: bigint;
      scope: "CURRENT_PERIOD" | "WHILE_TARIFF_ACTIVE";
      status: string;
      tariffIdAtGrant: string | null;
      validPeriodStartAt: Date | null;
    }>;
    subscription: { expireAt: Date | null };
  },
  now: Date,
) {
  if (quota.periodEndsAt.getTime() > now.getTime()
    || !quota.subscription.expireAt
    || quota.subscription.expireAt.getTime() <= now.getTime()) {
    return quota;
  }

  await tx.trafficQuotaGrant.updateMany({
    where: { quotaId: quota.id, status: "ACTIVE", scope: "CURRENT_PERIOD" },
    data: { status: "EXPIRED" },
  });
  const periodStartedAt = now;
  const updated = await tx.squadTrafficQuota.update({
    where: { id: quota.id },
    data: {
      usedBytes: 0n,
      periodStartedAt,
      periodEndsAt: nextMonthlyBoundary(periodStartedAt),
      notifiedPercents: [],
      status: "ACTIVE",
      exhaustedAt: null,
      lastAccountedAt: null,
    },
    include: { grants: true, subscription: { select: { expireAt: true } } },
  });
  const limitBytes = effectiveLimitBytes(
    updated.baseLimitBytes,
    activeGrants(updated.grants),
    updated.tariffIdAtPeriodStart,
    updated.periodStartedAt,
  );
  await writeEvent(tx, {
    quotaId: updated.id,
    kind: "PERIOD_ROLLOVER",
    usedBytes: 0n,
    limitBytes,
  });
  return updated;
}

export async function applyTrafficEntitlement(
  subscriptionId: string,
  tariffOrTrial: TrafficEntitlementInput,
  reason: TrafficEntitlementReason,
  now: Date = new Date(),
  dependencies: TrafficEntitlementDependencies = defaultDependencies,
) {
  const input = validateTrafficEntitlement(tariffOrTrial);
  const subscription = await dependencies.prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: { id: true, remnawaveUuid: true, expireAt: true },
  });
  if (!subscription) throw new Error("Подписка не найдена");

  if (input.mode === "LOCAL_SQUAD") {
    if (!subscription.remnawaveUuid) throw new Error("Подписка не привязана к Remnawave");
    const update = await dependencies.updateRemnaUser({
      uuid: subscription.remnawaveUuid,
      trafficLimitBytes: 0,
      trafficLimitStrategy: "NO_RESET",
    });
    if (update.error) throw new Error(update.error);
  }

  return dependencies.prisma.$transaction(async (tx) => {
    const current = await tx.squadTrafficQuota.findUnique({
      where: { subscriptionId },
      include: { grants: true, subscription: { select: { expireAt: true } } },
    });

    if (input.mode === "REMNAWAVE") {
      if (current) await tx.squadTrafficQuota.deleteMany({ where: { subscriptionId } });
      return null;
    }

    const baseLimitBytes = input.trafficLimitBytes ?? 0n;
    const meteredSquadUuid = input.meteredSquadUuid!;
    if (!current) {
      const created = await tx.squadTrafficQuota.create({
        data: {
          subscriptionId,
          tariffIdAtPeriodStart: input.tariffId,
          meteredSquadUuid,
          baseLimitBytes,
          usedBytes: 0n,
          periodStartedAt: now,
          periodEndsAt: nextMonthlyBoundary(now),
          notifiedPercents: [],
          status: "ACTIVE",
        },
        include: { grants: true, subscription: { select: { expireAt: true } } },
      });
      if (reason === "NEW_PURCHASE") {
        await tx.trafficUsageCheckpoint.upsert({
          where: { subscriptionId },
          create: {
            subscriptionId,
            squadUuid: meteredSquadUuid,
            currentDate: now,
            currentObservedBytes: 0n,
            previousDate: null,
            previousObservedBytes: 0n,
          },
          update: {
            squadUuid: meteredSquadUuid,
            currentDate: now,
            currentObservedBytes: 0n,
            previousDate: null,
            previousObservedBytes: 0n,
          },
        });
      }
      await writeEvent(tx, {
        quotaId: created.id,
        kind: "ENTITLEMENT_CREATED",
        usedBytes: 0n,
        limitBytes: baseLimitBytes,
        detail: { reason },
      });
      return created;
    }

    if (current.tariffIdAtPeriodStart !== input.tariffId) {
      await tx.trafficQuotaGrant.updateMany({
        where: { quotaId: current.id, status: "ACTIVE" },
        data: { status: "EXPIRED" },
      });
      const updated = await tx.squadTrafficQuota.update({
        where: { id: current.id },
        data: {
          tariffIdAtPeriodStart: input.tariffId,
          meteredSquadUuid,
          baseLimitBytes,
          usedBytes: 0n,
          periodStartedAt: now,
          periodEndsAt: nextMonthlyBoundary(now),
          notifiedPercents: [],
          status: "ACTIVE",
          exhaustedAt: null,
          lastAccountedAt: null,
        },
        include: { grants: true, subscription: { select: { expireAt: true } } },
      });
      await writeEvent(tx, {
        quotaId: updated.id,
        kind: "TARIFF_CHANGED",
        usedBytes: 0n,
        limitBytes: baseLimitBytes,
        detail: { reason, tariffId: input.tariffId },
      });
      return updated;
    }

    const configured = await tx.squadTrafficQuota.update({
      where: { id: current.id },
      data: { meteredSquadUuid, baseLimitBytes },
      include: { grants: true, subscription: { select: { expireAt: true } } },
    });
    return rolloverInTransaction(tx, configured, now);
  });
}

export async function rolloverTrafficQuota(
  subscriptionId: string,
  now: Date = new Date(),
  dependencies: TrafficEntitlementDependencies = defaultDependencies,
) {
  return dependencies.prisma.$transaction(async (tx) => {
    const quota = await tx.squadTrafficQuota.findUnique({
      where: { subscriptionId },
      include: { grants: true, subscription: { select: { expireAt: true } } },
    });
    return quota ? rolloverInTransaction(tx, quota, now) : null;
  });
}

export async function grantTrafficBytes(
  subscriptionId: string,
  bytes: bigint,
  scope: "CURRENT_PERIOD" | "WHILE_TARIFF_ACTIVE",
  actorId: string,
  dependencies: TrafficEntitlementDependencies = defaultDependencies,
) {
  if (bytes <= 0n) throw new Error("Количество байт должно быть положительным");
  return dependencies.prisma.$transaction(async (tx) => {
    const quota = await tx.squadTrafficQuota.findUnique({
      where: { subscriptionId },
      include: { grants: true },
    });
    if (!quota) throw new Error("Локальная квота подписки не найдена");

    const grant = await tx.trafficQuotaGrant.create({
      data: {
        quotaId: quota.id,
        bytes,
        scope,
        tariffIdAtGrant: scope === "WHILE_TARIFF_ACTIVE" ? quota.tariffIdAtPeriodStart : null,
        validPeriodStartAt: scope === "CURRENT_PERIOD" ? quota.periodStartedAt : null,
      },
    });
    const limitBytes = effectiveLimitBytes(
      quota.baseLimitBytes,
      [...activeGrants(quota.grants), grant],
      quota.tariffIdAtPeriodStart,
      quota.periodStartedAt,
    );
    await writeEvent(tx, {
      quotaId: quota.id,
      kind: "GRANT_CREATED",
      deltaBytes: bytes,
      usedBytes: quota.usedBytes,
      limitBytes,
      detail: { grantId: grant.id, actorId, scope },
    });
    return grant;
  });
}

export async function revokeTrafficGrant(
  grantId: string,
  actorId: string,
  dependencies: TrafficEntitlementDependencies = defaultDependencies,
  now: Date = new Date(),
) {
  return dependencies.prisma.$transaction(async (tx) => {
    const current = await tx.trafficQuotaGrant.findUnique({
      where: { id: grantId },
      include: { quota: { include: { grants: true } } },
    });
    if (!current) throw new Error("Начисление трафика не найдено");
    if (current.status !== "ACTIVE") return current;

    const grant = await tx.trafficQuotaGrant.update({
      where: { id: grantId },
      data: { status: "REVOKED", revokedAt: now },
    });
    const remaining = activeGrants(current.quota.grants).filter((item) => item.id !== grantId);
    const limitBytes = effectiveLimitBytes(
      current.quota.baseLimitBytes,
      remaining,
      current.quota.tariffIdAtPeriodStart,
      current.quota.periodStartedAt,
    );
    await writeEvent(tx, {
      quotaId: current.quota.id,
      kind: "GRANT_REVOKED",
      deltaBytes: -current.bytes,
      usedBytes: current.quota.usedBytes,
      limitBytes,
      detail: { grantId, actorId },
    });
    return grant;
  });
}

async function setTrafficQuotaStatus(
  subscriptionId: string,
  status: "SUSPENDED" | "ACTIVE",
  actorId: string,
  dependencies: TrafficEntitlementDependencies = defaultDependencies,
) {
  return dependencies.prisma.$transaction(async (tx) => {
    const quota = await tx.squadTrafficQuota.findUnique({
      where: { subscriptionId },
      include: { grants: true },
    });
    if (!quota) throw new Error("Локальная квота подписки не найдена");

    const updated = await tx.squadTrafficQuota.update({
      where: { id: quota.id },
      data: { status },
      include: { grants: true },
    });
    const limitBytes = effectiveLimitBytes(
      updated.baseLimitBytes,
      activeGrants(updated.grants),
      updated.tariffIdAtPeriodStart,
      updated.periodStartedAt,
    );
    await writeEvent(tx, {
      quotaId: updated.id,
      kind: status === "SUSPENDED" ? "QUOTA_SUSPENDED" : "QUOTA_RESUMED",
      usedBytes: updated.usedBytes,
      limitBytes,
      detail: { actorId },
    });
    return updated;
  });
}

export function suspendTrafficQuota(
  subscriptionId: string,
  actorId: string,
  dependencies: TrafficEntitlementDependencies = defaultDependencies,
) {
  return setTrafficQuotaStatus(subscriptionId, "SUSPENDED", actorId, dependencies);
}

export function resumeTrafficQuota(
  subscriptionId: string,
  actorId: string,
  dependencies: TrafficEntitlementDependencies = defaultDependencies,
) {
  return setTrafficQuotaStatus(subscriptionId, "ACTIVE", actorId, dependencies);
}

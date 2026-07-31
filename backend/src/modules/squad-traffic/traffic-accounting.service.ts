import { prisma } from "../../db.js";
import { crossedRemainingPercents, effectiveLimitBytes } from "./traffic-period.js";

export type TrafficUsageSample = {
  subscriptionId: string;
  date: string;
  observedBytes: bigint;
};

export type AccountingAnomaly = {
  subscriptionId: string;
  kind: "SOURCE_DECREASED" | "STALE_SAMPLE" | "INVALID_SAMPLE" | "CONCURRENT_UPDATE";
};

export type AccountingResult = {
  crossedPercentsBySubscription: Map<string, number[]>;
  exhaustedSubscriptionIds: Set<string>;
  anomalies: AccountingAnomaly[];
  changedCount: number;
};

export type TrafficAccountingDependencies = {
  prisma: {
    $transaction: (callback: (tx: any) => Promise<unknown>) => Promise<unknown>;
  };
};

const defaultDependencies: TrafficAccountingDependencies = { prisma };

type Checkpoint = {
  subscriptionId: string;
  squadUuid: string;
  currentDate: Date | null;
  currentObservedBytes: bigint;
  previousDate: Date | null;
  previousObservedBytes: bigint;
};

function dayDate(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const value = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function sameDay(left: Date | null, right: Date): boolean {
  return left?.getTime() === right.getTime();
}

function eventData(quota: any, kind: string, usedBytes: bigint, limitBytes: bigint, deltaBytes?: bigint) {
  return {
    quotaId: quota.id,
    kind,
    usedBytes,
    limitBytes,
    ...(deltaBytes === undefined ? {} : { deltaBytes }),
  };
}

/**
 * Applies all broker observations in one transaction. A newly seen day is only a
 * checkpoint baseline; later changes for either bounded day slot add positive deltas.
 */
export async function accountTrafficBatch(
  samples: TrafficUsageSample[],
  now: Date = new Date(),
  dependencies: TrafficAccountingDependencies = defaultDependencies,
): Promise<AccountingResult> {
  const transactionResult = await dependencies.prisma.$transaction(async (tx: any) => {
    const result: AccountingResult = {
      crossedPercentsBySubscription: new Map(),
      exhaustedSubscriptionIds: new Set(),
      anomalies: [],
      changedCount: 0,
    };

    for (const sample of samples) {
      const observedDay = dayDate(sample.date);
      if (!observedDay || sample.observedBytes < 0n) {
        result.anomalies.push({ subscriptionId: sample.subscriptionId, kind: "INVALID_SAMPLE" });
        continue;
      }

      const quota = await tx.squadTrafficQuota.findUnique({
        where: { subscriptionId: sample.subscriptionId },
        include: { grants: true },
      });
      if (!quota) continue;

      const checkpoint = await tx.trafficUsageCheckpoint.findUnique({
        where: { subscriptionId: sample.subscriptionId },
      }) as Checkpoint | null;
      if (!checkpoint) {
        await tx.trafficUsageCheckpoint.create({
          data: {
            subscriptionId: sample.subscriptionId,
            squadUuid: quota.meteredSquadUuid,
            currentDate: observedDay,
            currentObservedBytes: sample.observedBytes,
            previousDate: null,
            previousObservedBytes: 0n,
          },
        });
        result.changedCount++;
        continue;
      }

      let observedField: "currentObservedBytes" | "previousObservedBytes";
      let checkpointData: Partial<Checkpoint> | null = null;
      if (sameDay(checkpoint.currentDate, observedDay)) {
        observedField = "currentObservedBytes";
      } else if (sameDay(checkpoint.previousDate, observedDay)) {
        observedField = "previousObservedBytes";
      } else if (!checkpoint.currentDate || observedDay.getTime() > checkpoint.currentDate.getTime()) {
        await tx.trafficUsageCheckpoint.update({
          where: { subscriptionId: sample.subscriptionId },
          data: {
            previousDate: checkpoint.currentDate,
            previousObservedBytes: checkpoint.currentObservedBytes,
            currentDate: observedDay,
            currentObservedBytes: sample.observedBytes,
            squadUuid: quota.meteredSquadUuid,
          },
        });
        result.changedCount++;
        continue;
      } else {
        result.anomalies.push({ subscriptionId: sample.subscriptionId, kind: "STALE_SAMPLE" });
        continue;
      }

      const saved = checkpoint[observedField];
      if (sample.observedBytes === saved) continue;
      checkpointData = { [observedField]: sample.observedBytes };
      if (sample.observedBytes < saved) {
        await tx.trafficUsageCheckpoint.update({
          where: { subscriptionId: sample.subscriptionId },
          data: checkpointData,
        });
        const limitBytes = effectiveLimitBytes(
          quota.baseLimitBytes,
          quota.grants.filter((grant: { status: string }) => grant.status === "ACTIVE"),
          quota.tariffIdAtPeriodStart,
          quota.periodStartedAt,
        );
        await tx.trafficQuotaEvent.create({
          data: eventData(quota, "SOURCE_DECREASED", quota.usedBytes, limitBytes),
        });
        result.anomalies.push({ subscriptionId: sample.subscriptionId, kind: "SOURCE_DECREASED" });
        result.changedCount++;
        continue;
      }

      const deltaBytes = sample.observedBytes - saved;
      const limitBytes = effectiveLimitBytes(
        quota.baseLimitBytes,
        quota.grants.filter((grant: { status: string }) => grant.status === "ACTIVE"),
        quota.tariffIdAtPeriodStart,
        quota.periodStartedAt,
      );
      const nextUsedBytes = quota.usedBytes + deltaBytes;
      const newlyExhausted = limitBytes > 0n && quota.status !== "EXHAUSTED" && nextUsedBytes >= limitBytes;
      const crossedPercents = limitBytes > 0n
        ? crossedRemainingPercents(quota.usedBytes, nextUsedBytes, limitBytes)
        : [];
      const quotaUpdate = await tx.squadTrafficQuota.updateMany({
        where: { id: quota.id, updatedAt: quota.updatedAt },
        data: {
          usedBytes: nextUsedBytes,
          lastAccountedAt: now,
          ...(newlyExhausted ? { status: "EXHAUSTED", exhaustedAt: now } : {}),
        },
      });
      if (quotaUpdate.count !== 1) {
        result.anomalies.push({ subscriptionId: sample.subscriptionId, kind: "CONCURRENT_UPDATE" });
        continue;
      }

      await tx.trafficUsageCheckpoint.update({
        where: { subscriptionId: sample.subscriptionId },
        data: checkpointData,
      });
      await tx.trafficQuotaEvent.create({
        data: eventData(quota, "TRAFFIC_ACCOUNTED", nextUsedBytes, limitBytes, deltaBytes),
      });
      if (crossedPercents.length > 0) result.crossedPercentsBySubscription.set(sample.subscriptionId, crossedPercents);
      if (newlyExhausted) result.exhaustedSubscriptionIds.add(sample.subscriptionId);
      result.changedCount += 2;
    }

    return result;
  });
  return transactionResult as AccountingResult;
}

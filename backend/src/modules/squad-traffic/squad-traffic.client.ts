import { effectiveLimitBytes } from "./traffic-period.js";

export type ClientTrafficQuota = {
  status: string;
  usedBytes: string;
  limitBytes: string;
  remainingBytes: string;
  remainingPercent: number;
  periodStartedAt: string;
  periodEndsAt: string;
};

type QuotaGrant = {
  status: string;
  scope: "CURRENT_PERIOD" | "WHILE_TARIFF_ACTIVE";
  bytes: bigint;
  tariffIdAtGrant: string | null;
  validPeriodStartAt: Date | null;
};

export function toClientTrafficQuota(quota: {
  tariffIdAtPeriodStart: string | null;
  baseLimitBytes: bigint;
  usedBytes: bigint;
  status: string;
  periodStartedAt: Date;
  periodEndsAt: Date;
  grants: QuotaGrant[];
} | null | undefined): ClientTrafficQuota | null {
  if (!quota) return null;
  const limitBytes = effectiveLimitBytes(
    quota.baseLimitBytes,
    quota.grants.filter((grant) => grant.status === "ACTIVE"),
    quota.tariffIdAtPeriodStart,
    quota.periodStartedAt,
  );
  const unlimited = limitBytes === 0n;
  const remainingBytes = unlimited ? 0n : limitBytes > quota.usedBytes ? limitBytes - quota.usedBytes : 0n;
  return {
    status: quota.status,
    usedBytes: quota.usedBytes.toString(),
    limitBytes: limitBytes.toString(),
    remainingBytes: remainingBytes.toString(),
    remainingPercent: unlimited ? 100 : Number((remainingBytes * 100n) / limitBytes),
    periodStartedAt: quota.periodStartedAt.toISOString(),
    periodEndsAt: quota.periodEndsAt.toISOString(),
  };
}

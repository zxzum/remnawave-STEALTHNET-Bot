import { effectiveLimitBytes } from "../squad-traffic/traffic-period.js";

type Grant = {
  status: string;
  scope: "CURRENT_PERIOD" | "WHILE_TARIFF_ACTIVE";
  bytes: bigint;
  tariffIdAtGrant: string | null;
  validPeriodStartAt: Date | null;
};

type Quota = {
  tariffIdAtPeriodStart: string | null;
  baseLimitBytes: bigint;
  usedBytes: bigint;
  status: string;
  periodStartedAt: Date;
  updatedAt: Date;
  grants: Grant[];
};

export type PublicWhitelistQuota =
  | { status: "ready"; usedBytes: number; limitBytes: number; remainingBytes: number; percent: number; asOf: string }
  | { status: "unavailable" };

export function toPublicWhitelistQuota(quota: Quota): PublicWhitelistQuota {
  if (quota.status === "CONFIG_ERROR" || Number.isNaN(quota.updatedAt.getTime())) return { status: "unavailable" };

  const limitBytes = effectiveLimitBytes(
    quota.baseLimitBytes,
    quota.grants.filter((grant) => grant.status === "ACTIVE"),
    quota.tariffIdAtPeriodStart,
    quota.periodStartedAt,
  );
  const { usedBytes } = quota;
  if (limitBytes <= 0n || usedBytes < 0n || usedBytes > limitBytes) return { status: "unavailable" };

  const remainingBytes = limitBytes - usedBytes;
  if (![usedBytes, limitBytes, remainingBytes].every((value) => value <= BigInt(Number.MAX_SAFE_INTEGER))) {
    return { status: "unavailable" };
  }

  return {
    status: "ready",
    usedBytes: Number(usedBytes),
    limitBytes: Number(limitBytes),
    remainingBytes: Number(remainingBytes),
    percent: Number(((usedBytes * 10_000n + limitBytes / 2n) / limitBytes)) / 100,
    asOf: quota.updatedAt.toISOString(),
  };
}

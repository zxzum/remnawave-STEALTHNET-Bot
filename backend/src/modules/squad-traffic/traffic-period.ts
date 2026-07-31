export type GrantInput = {
  bytes: bigint;
  scope: "CURRENT_PERIOD" | "WHILE_TARIFF_ACTIVE";
  tariffIdAtGrant: string | null;
  validPeriodStartAt: Date | null;
};

const REMAINING_PERCENTS = [50, 25, 10, 3, 0];

export function nextMonthlyBoundary(start: Date): Date {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(Date.UTC(
    year,
    month,
    Math.min(start.getUTCDate(), lastDay),
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds(),
    start.getUTCMilliseconds(),
  ));
}

export function effectiveLimitBytes(
  base: bigint,
  grants: GrantInput[],
  tariffId: string | null,
  periodStart: Date,
): bigint {
  return grants.reduce((limit, grant) => (
    (grant.scope === "CURRENT_PERIOD" && grant.validPeriodStartAt?.getTime() === periodStart.getTime())
    || (grant.scope === "WHILE_TARIFF_ACTIVE" && grant.tariffIdAtGrant === tariffId)
      ? limit + grant.bytes
      : limit
  ), base);
}

export function crossedRemainingPercents(previousUsed: bigint, nextUsed: bigint, limit: bigint): number[] {
  if (limit === 0n) return [];

  return REMAINING_PERCENTS.filter((percent) => {
    const threshold = limit * BigInt(percent);
    return (limit - previousUsed) * 100n > threshold && (limit - nextUsed) * 100n <= threshold;
  });
}

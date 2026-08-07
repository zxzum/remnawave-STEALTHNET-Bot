export type MergeChoice = "smart" | "keep_both" | "to_primary" | "to_absorbed";

export type MergeSubscriptionSnapshot = {
  id: string;
  owner: "primary" | "absorbed";
  tariffId: string | null;
  tariffName: string | null;
  trialId: string | null;
  trialName: string | null;
  expireAt: string | Date | null;
  tariffPrice: number | null;
  tariffDurationDays: number | null;
  tariffCurrency: string | null;
  currentPricePerDay: number | null;
  giftStatus?: string | null;
  purchasedAsGift?: boolean;
};

export type MergeAccountSnapshot = {
  id: string;
  email: string | null;
  balance: number;
  paymentsCount: number;
  subscriptions: MergeSubscriptionSnapshot[];
};

export type MergePreview = {
  defaultChoice: "smart";
  primary: Pick<MergeAccountSnapshot, "id" | "email" | "balance" | "paymentsCount">;
  absorbed: Pick<MergeAccountSnapshot, "id" | "email" | "balance" | "paymentsCount">;
  trials: {
    keptSubscriptionId: string | null;
    keptExpireAt: string | null;
    removedSubscriptionIds: string[];
    summed: false;
  };
  sameTariffs: Array<{
    tariffId: string;
    tariffName: string;
    subscriptionIds: string[];
    remainingDays: number;
    summedRemainingDays: number;
    finalExpireAt: string | null;
    removedSubscriptionIds: string[];
  }>;
  conversionOptions: Array<{
    value: "keep_both" | "to_primary" | "to_absorbed";
    label: string;
    targetTariffName?: string;
    convertedDays?: number;
  }>;
};

const DAY_MS = 86_400_000;

function toDate(value: string | Date | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function remainingDays(subscription: MergeSubscriptionSnapshot, now: Date): number {
  const expireAt = toDate(subscription.expireAt);
  return expireAt ? Math.max(0, Math.floor((expireAt.getTime() - now.getTime()) / DAY_MS)) : 0;
}

function remainingMs(subscription: MergeSubscriptionSnapshot, now: Date): number {
  const expireAt = toDate(subscription.expireAt);
  return expireAt ? Math.max(0, expireAt.getTime() - now.getTime()) : 0;
}

function pricePerDay(subscription: MergeSubscriptionSnapshot): number | null {
  if (subscription.currentPricePerDay != null && subscription.currentPricePerDay > 0) return subscription.currentPricePerDay;
  if (subscription.tariffPrice != null && subscription.tariffDurationDays && subscription.tariffDurationDays > 0) {
    return subscription.tariffPrice / subscription.tariffDurationDays;
  }
  return null;
}

function convertedDays(source: MergeSubscriptionSnapshot, target: MergeSubscriptionSnapshot, now: Date): number | null {
  const oldPrice = pricePerDay(source);
  const newPrice = pricePerDay(target);
  if (oldPrice == null || newPrice == null || newPrice <= 0) return null;
  if ((source.tariffCurrency ?? "").toLowerCase() !== (target.tariffCurrency ?? "").toLowerCase()) return null;
  return Math.max(0, Math.floor((remainingDays(source, now) * oldPrice) / newPrice));
}

function paidSubscriptions(account: MergeAccountSnapshot): MergeSubscriptionSnapshot[] {
  return account.subscriptions.filter((subscription) => !subscription.trialId && !subscription.giftStatus && !subscription.purchasedAsGift);
}

function latestByExpiry(items: MergeSubscriptionSnapshot[], now: Date): MergeSubscriptionSnapshot | null {
  return [...items].sort((a, b) => remainingMs(b, now) - remainingMs(a, now))[0] ?? null;
}

function formatDate(value: Date | null): string | null {
  return value && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

function conversionOption(
  value: "to_primary" | "to_absorbed",
  target: MergeSubscriptionSnapshot,
  sources: MergeSubscriptionSnapshot[],
  now: Date,
): MergePreview["conversionOptions"][number] | null {
  const days = sources.reduce<number | null>((sum, source) => {
    const converted = convertedDays(source, target, now);
    return sum == null || converted == null ? null : sum + converted;
  }, 0);
  if (days == null) return null;
  return {
    value,
    label: `Объединить в «${target.tariffName ?? "выбранный тариф"}»`,
    targetTariffName: target.tariffName ?? undefined,
    convertedDays: days,
  };
}

export function buildMergePreview(primary: MergeAccountSnapshot, absorbed: MergeAccountSnapshot, now = new Date()): MergePreview {
  const all = [...primary.subscriptions, ...absorbed.subscriptions];
  const trials = all.filter((subscription) => Boolean(subscription.trialId));
  const keptTrial = latestByExpiry(trials, now);
  const paid = [...paidSubscriptions(primary), ...paidSubscriptions(absorbed)];
  const byTariff = new Map<string, MergeSubscriptionSnapshot[]>();
  for (const subscription of paid) {
    if (!subscription.tariffId) continue;
    const group = byTariff.get(subscription.tariffId) ?? [];
    group.push(subscription);
    byTariff.set(subscription.tariffId, group);
  }

  const sameTariffs = [...byTariff.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([tariffId, items]) => {
      const latest = latestByExpiry(items, now);
      const totalRemainingMs = items.reduce((sum, item) => sum + remainingMs(item, now), 0);
      const summedRemainingDays = Math.floor(totalRemainingMs / DAY_MS);
      return {
        tariffId,
        tariffName: latest?.tariffName ?? items[0]?.tariffName ?? "Тариф",
        subscriptionIds: items.map((item) => item.id),
        remainingDays: latest ? remainingDays(latest, now) : 0,
        summedRemainingDays,
        finalExpireAt: summedRemainingDays > 0 ? new Date(now.getTime() + totalRemainingMs).toISOString() : null,
        removedSubscriptionIds: items.filter((item) => item.id !== latest?.id).map((item) => item.id),
      };
    });

  const conversionOptions: MergePreview["conversionOptions"] = [{
    value: "keep_both",
    label: "Оставить разные тарифы отдельными",
  }];
  const tariffIds = [...byTariff.keys()];
  if (tariffIds.length > 1) {
    const primaryTarget = latestByExpiry(paid.filter((item) => item.owner === "primary"), now);
    const absorbedTarget = latestByExpiry(paid.filter((item) => item.owner === "absorbed"), now);
    if (primaryTarget) {
      const option = conversionOption("to_primary", primaryTarget, paid.filter((item) => item.id !== primaryTarget.id), now);
      if (option) conversionOptions.push(option);
    }
    if (absorbedTarget) {
      const option = conversionOption("to_absorbed", absorbedTarget, paid.filter((item) => item.id !== absorbedTarget.id), now);
      if (option) conversionOptions.push(option);
    }
  }

  return {
    defaultChoice: "smart",
    primary: { id: primary.id, email: primary.email, balance: primary.balance, paymentsCount: primary.paymentsCount },
    absorbed: { id: absorbed.id, email: absorbed.email, balance: absorbed.balance, paymentsCount: absorbed.paymentsCount },
    trials: {
      keptSubscriptionId: keptTrial?.id ?? null,
      keptExpireAt: formatDate(toDate(keptTrial?.expireAt ?? null)),
      removedSubscriptionIds: trials.filter((item) => item.id !== keptTrial?.id).map((item) => item.id),
      summed: false,
    },
    sameTariffs,
    conversionOptions,
  };
}

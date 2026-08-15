export type ConversionDirection = "none" | "same" | "trial" | "upgrade" | "downgrade" | "equal";

export type ConversionInput = {
  remainingDays: number;
  oldPricePerDay: number | null;
  newPricePerDay: number;
  sameTariff: boolean;
  isTrial: boolean;
};

export type ConversionQuote = {
  allowed: boolean;
  direction: ConversionDirection;
  convertedDays: number;
  commissionPercent: number;
};

export type TrialBonusInput = {
  activeTrialDurations: number[];
  trialEverUsed: boolean;
  subscriptionEverExisted: boolean;
  priorPaidPurchase: boolean;
};

const deniedQuote = (): ConversionQuote => ({
  allowed: false,
  direction: "none",
  convertedDays: 0,
  commissionPercent: 0,
});

/**
 * Quotes the number of whole days carried into a tariff change.
 *
 * The quote is deliberately pure so preview and apply can share exactly the
 * same rounding and commission rules:
 * - upgrades round up, but require at least one raw day;
 * - downgrades apply the five percent service commission before flooring;
 * - a renewal or trial conversion carries whole remaining days one to one.
 */
export function quoteConvertedDays(input: ConversionInput): ConversionQuote {
  const remaining = Number.isFinite(input.remainingDays)
    ? Math.max(0, Math.floor(input.remainingDays))
    : 0;
  if (remaining === 0) return deniedQuote();

  const newPrice = input.newPricePerDay;
  if (!Number.isFinite(newPrice) || newPrice <= 0) return deniedQuote();

  if (input.sameTariff || input.isTrial) {
    return {
      allowed: true,
      direction: input.sameTariff ? "same" : "trial",
      convertedDays: remaining,
      commissionPercent: 0,
    };
  }

  const oldPrice = input.oldPricePerDay;
  if (!Number.isFinite(oldPrice) || (oldPrice ?? 0) <= 0) {
    return deniedQuote();
  }

  const raw = remaining * (oldPrice as number) / newPrice;
  if (newPrice > (oldPrice as number)) {
    return {
      allowed: raw >= 1,
      direction: "upgrade",
      convertedDays: raw >= 1 ? Math.ceil(raw) : 0,
      commissionPercent: 0,
    };
  }

  if (newPrice < (oldPrice as number)) {
    return {
      allowed: true,
      direction: "downgrade",
      convertedDays: Math.floor(raw * 0.95),
      commissionPercent: 5,
    };
  }

  return {
    allowed: true,
    direction: "equal",
    convertedDays: Math.floor(raw),
    commissionPercent: 0,
  };
}

/**
 * Returns the minimum active trial duration that can be added to a user's
 * first paid purchase. History guards make the bonus naturally one-shot.
 */
export function minimumEligibleTrialBonus(input: TrialBonusInput): number {
  if (input.trialEverUsed || input.subscriptionEverExisted || input.priorPaidPurchase) return 0;

  const durations = input.activeTrialDurations
    .filter((duration) => Number.isFinite(duration))
    .map((duration) => Math.floor(duration))
    .filter((duration) => duration > 0);
  return durations.length > 0 ? Math.min(...durations) : 0;
}

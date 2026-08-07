export type SubscriptionAccessItem = {
  subscriptionIndex?: number | null;
  tariffId?: string | null;
  trialId?: string | null;
};

export const FIRST_WELCOME_TRIAL_BUTTON = {
  text: "🎁 Активировать пробный период",
  callback_data: "menu:trial",
  style: "primary",
} as const;

export function selectPrimarySubscriptionItem<T extends SubscriptionAccessItem>(
  items: T[],
  hasAccess: (item: T) => boolean,
): T | undefined {
  const valid = items.filter(hasAccess);
  return valid.find((item) => item.subscriptionIndex === 0) ?? valid[0];
}

export function canExtendSubscription(item: Pick<SubscriptionAccessItem, "tariffId" | "trialId">): boolean {
  return Boolean(item.tariffId || item.trialId);
}

export function shouldPreserveSubscriptionLink(preview: {
  willConvert: boolean;
  mode?: string;
  subscription?: { isTrial?: boolean } | null;
}): boolean {
  return Boolean(preview.willConvert && preview.subscription?.isTrial);
}

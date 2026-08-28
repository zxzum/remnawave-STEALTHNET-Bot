export type PaymentUrls = {
  paymentUrl?: string | null;
  miniAppPayUrl?: string | null;
  webAppPayUrl?: string | null;
  payUrl?: string | null;
};

export type CabinetDevice = {
  id: string;
  name: string;
  os: string;
  app: string;
  hwid: string;
  connectedNow: boolean;
};

type SubscriptionDeviceShape = {
  hwid: string;
  platform?: string;
  deviceModel?: string;
  appName?: string;
  subscriptionId: string;
};

export function groupDevicesBySubscription(items: SubscriptionDeviceShape[]): Map<string, CabinetDevice[]> {
  const grouped = new Map<string, CabinetDevice[]>();
  for (const item of items) {
    const platform = item.platform?.trim() || "Устройство";
    const device: CabinetDevice = {
      id: item.hwid,
      hwid: item.hwid,
      name: item.deviceModel?.trim() || platform,
      os: platform,
      app: item.appName?.trim() || platform,
      connectedNow: false,
    };
    grouped.set(item.subscriptionId, [...(grouped.get(item.subscriptionId) ?? []), device]);
  }
  return grouped;
}

export type CabinetSubscription = {
  id: string;
  name: string;
  plan: string;
  protocol: string;
  status: "active" | "expired";
  daysLeft: number;
  totalDays: number;
  trafficUsedGB: number;
  trafficLimitGB: number | null;
  whitelistUsedGB: number;
  whitelistGB: number | null;
  trafficAllTimeGB: number;
  deviceLimit: number;
  devices: CabinetDevice[];
  keyUrl: string;
  expiresAt: string;
  source: { type: "root" | "secondary"; id: string };
  tariffId: string | null;
  trafficLimitMode: "LOCAL_SQUAD" | "REMNAWAVE";
  isTrial: boolean;
  convertTariffIds: string[];
  trialConvertEnabled: boolean;
  trialConvertAllTariffs: boolean;
  extraDevices: number;
  extraDevicesMonthlyPrice: number;
};

export function isExpiredTrial(subscription: Pick<CabinetSubscription, "isTrial" | "status">): boolean {
  return subscription.isTrial && subscription.status === "expired";
}

export type CabinetUser = {
  name: string;
  initials: string;
  telegramId: string;
  email: string;
  tgUsername: string;
  registeredAt: string;
  balance: number;
  currency: string;
};

export type CabinetClientApp = {
  id: string;
  name: string;
  color: "blue" | "violet";
  platforms: string[];
  stores: string;
  canConnect: boolean;
  deeplink: (key: string) => string;
  steps: string[];
  downloads: Array<{ label: string; url: string; type: string }>;
};

export type CabinetTransaction = {
  id: string;
  type: "topup" | "purchase" | "referral";
  title: string;
  detail: string;
  amount: number;
  date: string;
};

export type CabinetReferral = {
  percent: number;
  invited: number;
  earned: number;
  siteLink: string;
  botLink: string;
  levels: Array<{ level: number; percent: number; text: string }>;
};

export type TariffDuration = { days: number; multiplier: number };
export type DeviceAddon = { extra: number; perMonth: number; bestValue?: boolean };
export type TariffPlan = {
  id: string;
  name: string;
  emojiLine: string;
  monthlyPrice: number;
  traffic: string;
  whitelistGB: number | null;
  baseDevices: number;
  popular?: boolean;
  badges: string[];
  currency: string;
  durationOptions: Array<{ id: string | null; days: number; price: number }>;
  pricePerExtraDevice: number;
  maxExtraDevices: number;
  deviceDiscountTiers: Array<{ minExtraDevices: number; discountPercent: number }>;
};
export type TariffGroup = { id: string; title: string; plans: TariffPlan[] };

type PublicTariffGroupShape = {
  id: string;
  name: string;
  emoji?: string;
  tariffs: Array<{
    id: string;
    name: string;
    description?: string | null;
    durationDays: number;
    price: number;
    currency: string;
    trafficLimitBytes?: number | string | null;
    localTrafficLimitBytes?: number | string | null;
    trafficLimitMode?: "REMNAWAVE" | "LOCAL_SQUAD";
    meteredSquadUuid?: string | null;
    isBestChoice?: boolean;
    deviceLimit?: number | null;
    includedDevices: number;
    pricePerExtraDevice: number;
    maxExtraDevices: number;
    deviceDiscountTiers?: Array<{ minExtraDevices: number; discountPercent: number }>;
    priceOptions?: Array<{ id: string; durationDays: number; price: number; sortOrder: number }>;
  }>;
};

type SubscriptionPageShape = {
  platforms?: Record<string, {
    displayName?: Record<string, string>;
    apps?: Array<{
      name: string;
      blocks?: Array<{
        title?: Record<string, string>;
        description?: Record<string, string>;
        buttons?: Array<{ link: string; type: string; text?: Record<string, string> }>;
      }>;
    }>;
  }>;
} | null;

type ClientShape = {
  id: string;
  email?: string | null;
  telegramId?: string | null;
  telegramUsername?: string | null;
  balance?: number;
  preferredCurrency?: string;
  createdAt?: string;
};

type SubscriptionItem = {
  type: "root" | "secondary";
  id: string;
  subscriptionIndex: number | null;
  tariffDisplayName: string;
  subscription: unknown;
  trafficQuota?: unknown;
  trafficLimitMode?: "LOCAL_SQUAD" | "REMNAWAVE";
  tariffId?: string | null;
  trialId?: string | null;
  convertTariffIds?: string[];
  trialConvertEnabled?: boolean;
  trialConvertAllTariffs?: boolean;
  extraDevices?: number;
  extraDevicesMonthlyPrice?: number;
};

function subscriptionPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.response && typeof raw.response === "object") return raw.response as Record<string, unknown>;
  if (raw.data && typeof raw.data === "object") {
    const data = raw.data as Record<string, unknown>;
    if (data.response && typeof data.response === "object") return data.response as Record<string, unknown>;
  }
  return raw;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function mapClient(client: ClientShape): CabinetUser {
  const username = client.telegramUsername?.replace(/^@/, "").trim();
  const emailName = client.email?.split("@")[0]?.trim();
  const name = username || emailName || "Пользователь";
  const createdAt = client.createdAt ? new Date(client.createdAt) : null;
  return {
    name,
    initials: name.slice(0, 2).toUpperCase(),
    telegramId: client.telegramId || "Не привязан",
    email: client.email || "Не указан",
    tgUsername: username ? `@${username}` : "Не привязан",
    registeredAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleDateString("ru-RU") : "—",
    balance: finiteNumber(client.balance) ?? 0,
    currency: client.preferredCurrency || "rub",
  };
}

export function mapSubscription(
  item: SubscriptionItem,
  now = new Date(),
  devices: CabinetDevice[] = [],
): CabinetSubscription {
  const payload = subscriptionPayload(item.subscription) ?? {};
  const userTraffic = payload.userTraffic && typeof payload.userTraffic === "object"
    ? payload.userTraffic as Record<string, unknown>
    : null;
  const usedBytes = finiteNumber(userTraffic?.usedTrafficBytes ?? payload.trafficUsed) ?? 0;
  const limitBytes = finiteNumber(payload.trafficLimitBytes);
  const trafficQuota = item.trafficQuota && typeof item.trafficQuota === "object"
    ? item.trafficQuota as Record<string, unknown>
    : null;
  const whitelistUsedBytes = finiteNumber(trafficQuota?.usedBytes) ?? 0;
  const whitelistLimitBytes = finiteNumber(trafficQuota?.limitBytes);
  const expiry = typeof payload.expireAt === "string" ? new Date(payload.expireAt) : null;
  const validExpiry = expiry && !Number.isNaN(expiry.getTime()) ? expiry : null;
  const daysLeft = validExpiry ? Math.max(0, Math.ceil((validExpiry.getTime() - now.getTime()) / 86_400_000)) : 0;
  const status = typeof payload.status === "string" ? payload.status.toUpperCase() : "";
  const active = daysLeft > 0 && status !== "DISABLED" && status !== "EXPIRED";
  return {
    id: item.id,
    name: item.tariffDisplayName?.trim() || `Подписка #${item.subscriptionIndex ?? 0}`,
    plan: item.tariffDisplayName?.trim() || "Подписка",
    protocol: "Remnawave",
    status: active ? "active" : "expired",
    daysLeft,
    totalDays: Math.max(daysLeft, 1),
    trafficUsedGB: usedBytes / 1024 ** 3,
    trafficLimitGB: limitBytes && limitBytes > 0 ? limitBytes / 1024 ** 3 : null,
    whitelistUsedGB: whitelistUsedBytes / 1024 ** 3,
    whitelistGB: whitelistLimitBytes && whitelistLimitBytes > 0 ? whitelistLimitBytes / 1024 ** 3 : null,
    trafficAllTimeGB: usedBytes / 1024 ** 3,
    deviceLimit: Math.max(0, finiteNumber(payload.hwidDeviceLimit) ?? 0),
    devices,
    keyUrl: typeof payload.subscriptionUrl === "string" ? payload.subscriptionUrl.trim() : "",
    expiresAt: validExpiry ? validExpiry.toLocaleDateString("ru-RU") : "—",
    source: { type: item.type, id: item.id },
    tariffId: item.tariffId ?? null,
    trafficLimitMode: item.trafficLimitMode ?? (trafficQuota ? "LOCAL_SQUAD" : "REMNAWAVE"),
    isTrial: Boolean(item.trialId),
    convertTariffIds: item.convertTariffIds ?? [],
    trialConvertEnabled: item.trialConvertEnabled !== false,
    trialConvertAllTariffs: item.trialConvertAllTariffs === true,
    extraDevices: Math.max(0, finiteNumber(item.extraDevices) ?? 0),
    extraDevicesMonthlyPrice: Math.max(0, finiteNumber(item.extraDevicesMonthlyPrice) ?? 0),
  };
}

export function mapClientApps(config: SubscriptionPageShape): CabinetClientApp[] {
  const found = new Map<string, { name: string; platforms: string[]; stores: string[]; link: string; steps: string[]; downloads: Array<{ label: string; url: string; type: string }> }>();
  for (const [platformId, platform] of Object.entries(config?.platforms ?? {})) {
    const platformName = platform.displayName?.ru || platform.displayName?.en || platformId;
    for (const app of platform.apps ?? []) {
      const id = app.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || platformId;
      const existing = found.get(id);
      const blocks = app.blocks ?? [];
      const link = blocks.flatMap((block) => block.buttons ?? []).find((button) => button.type === "subscriptionLink")?.link ?? "";
      const downloads = blocks.flatMap((block) => block.buttons ?? [])
        .filter((button) => button.type !== "subscriptionLink" && safeExternalUrl(button.link))
        .map((button) => ({ label: button.text?.ru || button.text?.en || "Скачать", url: button.link, type: button.type }));
      const steps = blocks.flatMap((block) => [block.title?.ru || block.title?.en, block.description?.ru || block.description?.en])
        .filter((step): step is string => Boolean(step?.trim()));
      if (existing) {
        if (!existing.platforms.includes(platformId)) existing.platforms.push(platformId);
        if (!existing.stores.includes(platformName)) existing.stores.push(platformName);
        if (!existing.link && link) existing.link = link;
        if (existing.steps.length === 0 && steps.length > 0) existing.steps = steps;
        for (const download of downloads) if (!existing.downloads.some((item) => item.url === download.url)) existing.downloads.push(download);
      } else {
        found.set(id, { name: app.name, platforms: [platformId], stores: [platformName], link, steps, downloads });
      }
    }
  }
  return [...found.entries()].map(([id, app], index) => ({
    id,
    name: app.name,
    color: index % 2 === 0 ? "blue" : "violet",
    platforms: app.platforms,
    stores: app.stores.join(" · "),
    canConnect: Boolean(app.link),
    deeplink: (key: string) => app.link
      .replace(/\{\{SUBSCRIPTION_LINK\}\}|\{\{HAPP_CRYPT3_LINK\}\}|\{\{HAPP_CRYPT4_LINK\}\}/g, key),
    steps: app.steps,
    downloads: app.downloads,
  }));
}

export function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toLocaleString("ru-RU")} ${currency.toUpperCase()}`;
  }
}

export function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function mapTariffGroups(groups: PublicTariffGroupShape[]): TariffGroup[] {
  return groups.map((group) => ({
    id: group.id,
    title: group.name,
    plans: group.tariffs.map((tariff) => {
      const options = [
        { id: null, days: tariff.durationDays, price: tariff.price, sortOrder: -1 },
        ...(tariff.priceOptions ?? []).map((option) => ({ id: option.id, days: option.durationDays, price: option.price, sortOrder: option.sortOrder })),
      ].filter((option, index, all) => all.findIndex((candidate) => candidate.days === option.days) === index)
        .sort((a, b) => a.days - b.days || a.sortOrder - b.sortOrder)
        .map(({ id, days, price }) => ({ id, days, price }));
      const trafficBytes = finiteNumber(tariff.trafficLimitBytes);
      const localTrafficBytes = finiteNumber(tariff.localTrafficLimitBytes);
      const trafficGB = trafficBytes != null && trafficBytes > 0 ? trafficBytes / 1024 ** 3 : null;
      const whitelistGB = tariff.trafficLimitMode === "LOCAL_SQUAD"
        ? (localTrafficBytes != null && localTrafficBytes > 0 ? localTrafficBytes / 1024 ** 3 : trafficGB)
        : null;
      return {
        id: tariff.id,
        name: tariff.name,
        emojiLine: tariff.description ?? "",
        monthlyPrice: options[0]?.price ?? tariff.price,
        traffic: tariff.trafficLimitMode !== "LOCAL_SQUAD" && trafficGB ? `${Number(trafficGB.toFixed(1))} ГБ` : "Безлимит",
        whitelistGB,
        popular: Boolean(tariff.isBestChoice),
        baseDevices: tariff.includedDevices || tariff.deviceLimit || 0,
        badges: [],
        currency: tariff.currency,
        durationOptions: options,
        pricePerExtraDevice: tariff.pricePerExtraDevice,
        maxExtraDevices: tariff.maxExtraDevices,
        deviceDiscountTiers: tariff.deviceDiscountTiers ?? [],
      };
    }),
  }));
}

export function quoteTariff(plan: TariffPlan, days: number, extraDevices: number) {
  const option = plan.durationOptions.find((candidate) => candidate.days === days) ?? plan.durationOptions[0];
  const safeExtras = Math.min(plan.maxExtraDevices, Math.max(0, Math.floor(extraDevices)));
  const tier = [...plan.deviceDiscountTiers]
    .sort((a, b) => b.minExtraDevices - a.minExtraDevices)
    .find((candidate) => safeExtras >= candidate.minExtraDevices);
  const discountPercent = tier?.discountPercent ?? 0;
  const monthly = plan.pricePerExtraDevice * safeExtras * (100 - discountPercent) / 100;
  const extras = Math.round(monthly * (Math.max(1, option.days) / 30) * 100) / 100;
  const base = option.price;
  return { base, extras, total: Math.round((base + extras) * 100) / 100, discountPercent };
}

export function canBuyTrafficOption(
  option: { trafficMode?: "LOCAL_SQUAD" | "REMNAWAVE" | "ANY" },
  subscription: Pick<CabinetSubscription, "trafficLimitGB" | "whitelistGB" | "trafficLimitMode"> | null | undefined,
): boolean {
  const mode = option.trafficMode ?? "ANY";
  if (mode === "ANY") return true;
  if (!subscription) return false;
  if (mode === "REMNAWAVE") return subscription.trafficLimitGB !== null && subscription.trafficLimitGB > 0;
  return subscription.trafficLimitMode === "LOCAL_SQUAD" || subscription.whitelistGB !== null;
}

export type PlategaMethod = { id: number; label: string };

export function groupPlategaMethods(methods: PlategaMethod[]) {
  const used = new Set<number>();
  const take = (pattern: RegExp) => {
    const method = methods.find((candidate) => !used.has(candidate.id) && pattern.test(candidate.label));
    if (method) used.add(method.id);
    return method;
  };
  const sbp = take(/сбп|sbp|qr/i);
  const card = take(/карт|card/i);
  const crypto = take(/крипт|crypto/i);
  return { sbp, card, crypto, other: methods.filter((method) => !used.has(method.id)) };
}

export function trafficOptionLabel(mode: "LOCAL_SQUAD" | "REMNAWAVE" | "ANY" | undefined): string {
  if (mode === "LOCAL_SQUAD") return "Белые списки";
  if (mode === "REMNAWAVE") return "Обычный интернет";
  return "Для любой подписки";
}

export function trafficOptionUnitPrice(trafficGb: number, price: number): number {
  if (!Number.isFinite(trafficGb) || trafficGb <= 0 || !Number.isFinite(price)) return 0;
  return Math.round((price / trafficGb) * 100) / 100;
}

export function resolvePaymentUrl(urls: PaymentUrls, inTelegram: boolean): string | null {
  const candidates = [inTelegram ? urls.miniAppPayUrl : urls.webAppPayUrl, urls.paymentUrl, urls.payUrl, urls.webAppPayUrl];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" || url.protocol === "tg:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return candidate;
    } catch { /* ignore invalid provider URLs */ }
  }
  return null;
}

export function shouldOfferTelegramLink(client: { id: string; telegramId?: string | null } | null): boolean {
  return Boolean(client && !client.telegramId);
}

export function resolveOptionalNav(config: {
  customBuildConfig?: { enabled?: boolean } | null;
  sellOptionsEnabled?: boolean;
  showProxyEnabled?: boolean;
  showSingboxEnabled?: boolean;
  giftSubscriptionsEnabled?: boolean;
  ticketsEnabled?: boolean;
}): string[] {
  return [
    config.customBuildConfig?.enabled && "custom-build",
    config.sellOptionsEnabled && "extra-options",
    config.showProxyEnabled && "proxy",
    config.showSingboxEnabled && "singbox",
    config.giftSubscriptionsEnabled && "gifts",
    config.ticketsEnabled && "tickets",
  ].filter((value): value is string => Boolean(value));
}

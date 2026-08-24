export type MainMenuSubscription = {
  type: "root" | "secondary";
  id: string;
  subscriptionIndex: number | null;
  tariffId: string | null;
  tariffDisplayName: string;
  subscription: unknown;
  trafficQuota?: { usedBytes: string; limitBytes: string } | null;
  lazeikaOnly?: { active: boolean; daysLeft: number; message: string } | null;
};

export type MainMenuTariff = {
  id: string;
  name: string;
  price: number;
  currency: string;
  durationDays: number;
  trafficLimitBytes?: number | null;
};

const GB = 1024 ** 3;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function subscriptionUser(value: unknown): Record<string, unknown> | null {
  const outer = record(value);
  return record(outer?.response) ?? record(outer?.data) ?? record(outer?.user) ?? outer;
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatGb(bytes: number): string {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(bytes / GB)} ГБ`;
}

function formatPrice(price: number, currency: string): string {
  const symbol = ({ RUB: "₽", USD: "$", EUR: "€" } as Record<string, string>)[currency.toUpperCase()] ?? currency.toUpperCase();
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(price)} ${symbol}`;
}

export function selectPrimarySubscription(items: MainMenuSubscription[]): MainMenuSubscription | null {
  return items.find((item) => item.type === "root" || item.subscriptionIndex === 0) ?? items[0] ?? null;
}

export function buildMainMenuSummary(input: {
  subscription: MainMenuSubscription | null;
  tariff: MainMenuTariff | null;
  now?: Date;
}): string {
  const { subscription, tariff } = input;
  const lines = ["👋 Добро пожаловать в Лазейка ВПН!", ""];
  if (!subscription) {
    return [...lines, "🛡 Ваша подписка: 🔴 Не активна", "📦 Ваш тариф: не выбран", "", "Выберите действие 👇"].join("\n");
  }

  const user = subscriptionUser(subscription.subscription);
  const rawExpiry = user?.expireAt ?? user?.expirationDate ?? user?.expire_at;
  const expireAt = rawExpiry == null ? null : new Date(typeof rawExpiry === "number" ? rawExpiry * 1000 : String(rawExpiry));
  const validExpiry = expireAt && !Number.isNaN(expireAt.getTime()) ? expireAt : null;
  const rawStatus = String(user?.status ?? user?.userStatus ?? "ACTIVE").toUpperCase();
  const expired = rawStatus === "EXPIRED" || (validExpiry != null && validExpiry <= (input.now ?? new Date()));
  const grace = subscription.lazeikaOnly?.active === true;
  const status = grace ? "🔐 Особый доступ" : expired ? "🔴 Истекла"
    : rawStatus === "LIMITED" ? "🟡 Ограничена"
    : rawStatus === "DISABLED" ? "🔴 Отключена"
    : "🟢 Активна";
  lines.push(`🛡 Ваша подписка: ${status}`);
  if (validExpiry) {
    lines.push(`📅 Дата окончания: ${new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Moscow",
    }).format(validExpiry)}`);
  }

  if (grace) {
    lines.push("🔐 Особый доступ: Telegram и lazeika.xyz");
    lines.push(`⏰ Осталось: ${subscription.lazeikaOnly!.daysLeft} дней`);
  } else {
    const quotaUsed = finite(subscription.trafficQuota?.usedBytes);
    const quotaLimit = finite(subscription.trafficQuota?.limitBytes);
    if (quotaLimit != null && quotaLimit > 0) {
      lines.push(`☁️ Белый интернет: ${formatGb(quotaUsed ?? 0)} из ${formatGb(quotaLimit)}`);
    }

    const traffic = record(user?.userTraffic);
    const used = finite(traffic?.usedTrafficBytes ?? user?.trafficUsedBytes ?? user?.usedTrafficBytes ?? user?.traffic_used_bytes);
    const limit = finite(user?.trafficLimitBytes ?? user?.traffic_limit_bytes);
    if (used != null) {
      lines.push(limit != null && limit > 0
        ? `📊 Общий трафик: ${formatGb(used)} из ${formatGb(limit)}`
        : `📊 Общий трафик: ${formatGb(used)} · безлимит`);
    }
  }

  lines.push("");
  const tariffName = tariff?.name.trim() || subscription.tariffDisplayName.trim() || "не выбран";
  const tariffPrice = tariff
    ? ` · ${formatPrice(tariff.price, tariff.currency)}${tariff.durationDays === 30 ? "/мес." : ` / ${tariff.durationDays} дн.`}`
    : "";
  lines.push(`📦 Ваш тариф: ${tariffName}${tariffPrice}`);
  if (!grace) {
    const quotaLimit = finite(subscription.trafficQuota?.limitBytes);
    if (quotaLimit != null && quotaLimit > 0) lines.push(`🌐 Включено: ${formatGb(quotaLimit)} белого интернета`);
  }
  lines.push("", "Выберите действие 👇");
  return lines.join("\n");
}

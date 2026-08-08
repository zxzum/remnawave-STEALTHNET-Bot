import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

export type TelegramNotificationTopic = {
  settingKey: string;
  name: string;
};

export const MAIN_TELEGRAM_NOTIFICATION_TOPICS = [
  { settingKey: "notification_topic_new_clients", name: "👤 Новые клиенты" },
  { settingKey: "notification_topic_payments", name: "💳 Платежи" },
  { settingKey: "notification_topic_tickets", name: "🎫 Тикеты" },
  { settingKey: "notification_topic_backups", name: "💾 Авто-бэкапы" },
  { settingKey: "notification_topic_trials", name: "🎁 Пробный период" },
  { settingKey: "notification_topic_conversions", name: "🔄 Конвертации" },
  { settingKey: "notification_topic_withdrawals", name: "💸 Заявки на вывод" },
  { settingKey: "notification_topic_promo", name: "🏷 Промокоды" },
  { settingKey: "notification_topic_gifts", name: "🎟 Подарки" },
  { settingKey: "notification_topic_auto_renew", name: "⚠️ Сбои автосписания" },
  { settingKey: "notification_topic_subscription_revoked", name: "⛔ Аннулирование подписок" },
] as const satisfies readonly TelegramNotificationTopic[];

export const MANAGERS_TELEGRAM_NOTIFICATION_TOPIC = {
  settingKey: "notification_managers_topic_tickets",
  name: "🎫 Тикеты менеджеров",
} as const satisfies TelegramNotificationTopic;

export type TelegramTopicRequest = (url: string, init: RequestInit) => Promise<Response>;

type EnsureTelegramNotificationTopicsInput = {
  botToken?: string | null;
  groupId?: string | null;
  managersGroupId?: string | null;
  topicIds: Record<string, string | null | undefined>;
  setTopicId: (settingKey: string, topicId: string) => Promise<void>;
  request?: TelegramTopicRequest;
};

type TelegramCreateTopicResponse = {
  ok?: boolean;
  description?: string;
  result?: { message_thread_id?: number };
};

export function getTelegramTopicResetKeys(mainGroupChanged: boolean, managersGroupChanged: boolean): string[] {
  return [
    ...(mainGroupChanged ? MAIN_TELEGRAM_NOTIFICATION_TOPICS.map((topic) => topic.settingKey) : []),
    ...(managersGroupChanged ? [MANAGERS_TELEGRAM_NOTIFICATION_TOPIC.settingKey] : []),
  ];
}

async function defaultTelegramTopicRequest(url: string, init: RequestInit): Promise<Response> {
  return proxyFetch(url, init as RequestInit & { signal?: AbortSignal }, await getProxyUrl("telegram"));
}

async function createTelegramForumTopic(
  botToken: string,
  groupId: string,
  name: string,
  request: TelegramTopicRequest,
): Promise<string> {
  const response = await request(`https://api.telegram.org/bot${botToken}/createForumTopic`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: groupId, name }),
  });
  const data = (await response.json().catch(() => null)) as TelegramCreateTopicResponse | null;
  const topicId = data?.result?.message_thread_id;
  if (!data?.ok || typeof topicId !== "number" || !Number.isInteger(topicId) || topicId <= 0) {
    throw new Error(`Не удалось создать топик «${name}»: ${data?.description ?? `HTTP ${response.status}`}`);
  }
  return String(topicId);
}

async function ensureTopicsForGroup(
  botToken: string,
  groupId: string,
  topics: readonly TelegramNotificationTopic[],
  input: EnsureTelegramNotificationTopicsInput,
  request: TelegramTopicRequest,
): Promise<void> {
  for (const topic of topics) {
    if (input.topicIds[topic.settingKey]?.trim()) continue;
    const topicId = await createTelegramForumTopic(botToken, groupId, topic.name, request);
    await input.setTopicId(topic.settingKey, topicId);
    input.topicIds[topic.settingKey] = topicId;
  }
}

export async function ensureTelegramNotificationTopics(input: EnsureTelegramNotificationTopicsInput): Promise<void> {
  const groupId = input.groupId?.trim();
  const managersGroupId = input.managersGroupId?.trim();
  if (!groupId && !managersGroupId) return;

  const botToken = input.botToken?.trim();
  if (!botToken) throw new Error("Не задан токен Telegram-бота для создания топиков");

  const request = input.request ?? defaultTelegramTopicRequest;
  if (groupId) await ensureTopicsForGroup(botToken, groupId, MAIN_TELEGRAM_NOTIFICATION_TOPICS, input, request);
  if (managersGroupId) {
    await ensureTopicsForGroup(botToken, managersGroupId, [MANAGERS_TELEGRAM_NOTIFICATION_TOPIC], input, request);
  }
}

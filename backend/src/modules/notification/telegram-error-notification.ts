export type BotErrorReport = {
  occurredAt?: string;
  method?: string;
  errorName?: string;
  message: string;
  stack?: string;
  telegram?: {
    userId?: number;
    username?: string;
    firstName?: string;
    lastName?: string;
    languageCode?: string;
    chatId?: number | string;
    messageId?: number;
    updateId?: number;
    text?: string;
    callbackData?: string;
  };
  payload?: Record<string, unknown>;
};

export type BotErrorClient = {
  id: string;
  email: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  balance?: number;
  createdAt?: string | Date;
  subscriptionsCount?: number;
  paymentsCount?: number;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function truncate(value: unknown, length: number): string {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function payloadText(payload: Record<string, unknown> | undefined): string | null {
  if (!payload) return null;
  const allowed = ["chat_id", "message_id", "message_thread_id", "caption", "text", "parse_mode"];
  const safe = Object.fromEntries(allowed.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]));
  const text = JSON.stringify(safe);
  return text && text !== "{}" ? truncate(text, 700) : null;
}

export function formatBotErrorNotification(report: BotErrorReport, client?: BotErrorClient | null): string {
  const telegram = report.telegram;
  const username = client?.telegramUsername || telegram?.username;
  const userLabel = username ? `@${username.replace(/^@+/, "")}` : "без username";
  const userName = [telegram?.firstName, telegram?.lastName].filter(Boolean).join(" ");
  const lines = [
    "🚨 <b>Ошибка Telegram-бота Лазейка ВПН</b>",
    `🕒 Время: <code>${escapeHtml(report.occurredAt || new Date().toISOString())}</code>`,
    `⚙️ Метод: <code>${escapeHtml(report.method || "не определён")}</code>`,
    `❌ Ошибка: <code>${escapeHtml(truncate(report.message, 1800))}</code>`,
  ];

  if (client) {
    lines.push(
      "",
      "👤 <b>Пользователь</b>",
      `ID клиента: <code>${escapeHtml(client.id)}</code>`,
      `Email: <code>${escapeHtml(client.email || "не привязан")}</code>`,
      `Telegram: <code>${escapeHtml(client.telegramId || telegram?.userId || "не определён")}</code> (${escapeHtml(userLabel)})`,
    );
    if (client.balance != null) lines.push(`Баланс: <code>${escapeHtml(client.balance.toFixed(2))}</code>`);
    if (client.subscriptionsCount != null || client.paymentsCount != null) {
      lines.push(`Подписки: <code>${escapeHtml(client.subscriptionsCount ?? 0)}</code>, платежи: <code>${escapeHtml(client.paymentsCount ?? 0)}</code>`);
    }
    if (client.createdAt) lines.push(`Регистрация: <code>${escapeHtml(client.createdAt)}</code>`);
  } else {
    lines.push("", `👤 Telegram: <code>${escapeHtml(telegram?.userId || "не определён")}</code> (${escapeHtml(userLabel)})`);
  }
  if (userName) lines.push(`Имя: ${escapeHtml(userName)}`);
  if (telegram?.chatId !== undefined) lines.push(`Chat ID: <code>${escapeHtml(telegram.chatId)}</code>`);
  if (telegram?.messageId !== undefined) lines.push(`Message ID: <code>${escapeHtml(telegram.messageId)}</code>`);
  if (telegram?.updateId !== undefined) lines.push(`Update ID: <code>${escapeHtml(telegram.updateId)}</code>`);
  if (telegram?.text) lines.push(`Текст: <code>${escapeHtml(truncate(telegram.text, 300))}</code>`);
  if (telegram?.callbackData) lines.push(`Callback: <code>${escapeHtml(truncate(telegram.callbackData, 300))}</code>`);

  const payload = payloadText(report.payload);
  if (payload) lines.push(`Payload: <code>${escapeHtml(payload)}</code>`);
  if (report.stack) lines.push("", `<pre>${escapeHtml(truncate(report.stack, 1200))}</pre>`);
  return lines.join("\n");
}

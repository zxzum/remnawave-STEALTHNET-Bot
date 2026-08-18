/**
 * Уведомления пользователя в Telegram (пополнение баланса, оплата тарифа).
 * Вызывается из webhook'ов после успешной обработки платежа.
 */

import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";
import { isPlategaErrorNotificationSuppressed } from "../platega/platega.service.js";
import { remnaGetUser } from "../remna/remna.client.js";
import { extractRemnaSubscriptionUrl } from "../subscription/subscription-url.js";
import { isMailConfigured, mailConfigFromSystem, sendEmail, type SmtpConfig } from "../mail/mail.service.js";
import { renderEmailTemplate } from "../email-templates/email-templates.service.js";
import { readFile } from "node:fs/promises";

/** Inline keyboard with a single "Back to menu" button for client notifications. */
function backToMenuMarkup(backLabel?: string | null): Record<string, unknown> {
  return { inline_keyboard: [[{ text: backLabel || "◀️ В меню", callback_data: "menu:main" }]] };
}

export function subscriptionExpiryMarkup(label: string, callbackData = "menu:tariffs"): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{ text: label, callback_data: callbackData }],
      [{ text: "◀️ В меню", callback_data: "menu:main" }],
    ],
  };
}

export const SUBSCRIPTION_UPDATE_TEXT =
  "Откройте HAPP или INCY и обновите подписку: нажмите кнопку ↻ рядом с её названием. Ссылка останется прежней.";

/** Fallback-названия методов Platega, если метод не найден в настройках. */
const PLATEGA_METHOD_FALLBACK_LABELS: Record<number, string> = {
  2: "СБП",
  10: "Карты (CardRu)",
  11: "Карты РФ",
  12: "Международные карты",
  13: "Криптовалюта",
};

function isTrialToTariffPayment(metadata: string | null): boolean {
  try {
    return JSON.parse(metadata ?? "{}").trialToTariff === true;
  } catch {
    return false;
  }
}

async function sendSubscriptionUpdateGuides(telegramId: string, token: string): Promise<void> {
  try {
    const form = new FormData();
    form.append("chat_id", telegramId);
    form.append("media", JSON.stringify([
      { type: "photo", media: "attach://happ", caption: "HAPP: нажмите кнопку обновления ↻ рядом с подпиской." },
      { type: "photo", media: "attach://incy", caption: "INCY: нажмите кнопку обновления ↻ рядом с подпиской." },
    ]));
    form.append("happ", new Blob([await readFile(new URL("../../assets/guides/happ-how-to-update.png", import.meta.url))], { type: "image/png" }), "happ-how-to-update.png");
    form.append("incy", new Blob([await readFile(new URL("../../assets/guides/incy-how-to-update.png", import.meta.url))], { type: "image/png" }), "incy-how-to-update.png");
    const proxy = await getProxyUrl("telegram");
    const res = await proxyFetch(`https://api.telegram.org/bot${token}/sendMediaGroup`, { method: "POST", body: form }, proxy);
    if (!res.ok) console.warn("[Telegram notify] sendMediaGroup failed", await res.text().catch(() => res.statusText));
  } catch (e) {
    console.warn("[Telegram notify] update guides failed", e);
  }
}

type AdminNotificationEventType =
  | "balance_topup"
  | "tariff_payment"
  | "new_client"
  | "new_ticket"
  | "trial_activated"
  | "subscription_converted"
  | "withdrawal_request"
  | "promo_activated"
  | "gift_redeemed"
  | "auto_renew_failed"
  | "subscription_revoked"
  | "error";

type AdminNotificationPreferenceRow = {
  telegramId: string;
  notifyBalanceTopup: boolean;
  notifyTariffPayment: boolean;
  notifyNewClient: boolean;
  notifyNewTicket: boolean;
};

const anonymousPlategaErrorNotifications = new Map<string, number>();

function parsePlategaNotificationMetadata(raw: string | null): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function plategaErrorNotificationKey(kind: string, error: string, identity: string): string {
  return `${kind}:${identity}:${error.trim().replace(/\s+/g, " ").slice(0, 500) || "unknown"}`;
}

async function shouldNotifyPlategaError(
  paymentId: string | null | undefined,
  kind: string,
  error: string,
  identity: string,
): Promise<boolean> {
  const key = plategaErrorNotificationKey(kind, error, identity);
  if (!paymentId) {
    const previousAt = anonymousPlategaErrorNotifications.get(key);
    const now = Date.now();
    if (previousAt && isPlategaErrorNotificationSuppressed(key, new Date(previousAt).toISOString(), key, now)) return false;
    anonymousPlategaErrorNotifications.set(key, now);
    if (anonymousPlategaErrorNotifications.size > 128) {
      const oldestKey = anonymousPlategaErrorNotifications.keys().next().value;
      if (oldestKey) anonymousPlategaErrorNotifications.delete(oldestKey);
    }
    return true;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT "id" FROM "payments" WHERE "id" = $1 FOR UPDATE', paymentId);
      const payment = await tx.payment.findUnique({ where: { id: paymentId }, select: { metadata: true } });
      if (!payment) return true;
      const metadata = parsePlategaNotificationMetadata(payment.metadata);
      if (isPlategaErrorNotificationSuppressed(
        metadata.plategaErrorNotificationKey,
        metadata.plategaErrorNotificationAt,
        key,
      )) return false;
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          metadata: JSON.stringify({
            ...metadata,
            plategaErrorNotificationKey: key,
            plategaErrorNotificationAt: new Date().toISOString(),
          }),
        },
      });
      return true;
    });
  } catch (error) {
    console.warn("[Telegram notify] Platega error dedup failed", error);
    return true;
  }
}

export type TelegramUserSendOptions = { clientIdForBotToken?: string };

async function sendTelegramToUserChecked(
  telegramId: string,
  text: string,
  messageThreadId?: number | null,
  replyMarkup?: Record<string, unknown>,
  _opts?: TelegramUserSendOptions,
): Promise<boolean> {
  // v5.0.0: единственный бот, токен берётся из system_settings (или env).
  let token: string | undefined;
  {
    const config = await getSystemConfig();
    token = config.telegramBotToken?.trim() ?? undefined;
  }
  if (!token) {
    console.warn("[Telegram notify] Bot token not configured, skip notification");
    return false;
  }
  const chatId = telegramId.trim();
  if (!chatId) return false;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (messageThreadId) payload.message_thread_id = messageThreadId;
  if (replyMarkup) payload.reply_markup = replyMarkup;
  try {
    const proxy = await getProxyUrl("telegram");
    const res = await proxyFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, proxy);
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || !data.ok) {
      console.warn("[Telegram notify] sendMessage failed", { chatId: chatId.slice(0, 8) + "...", error: data.description ?? res.statusText });
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[Telegram notify] sendMessage error", e);
    return false;
  }
}

export async function sendTelegramToUser(
  telegramId: string,
  text: string,
  messageThreadId?: number | null,
  replyMarkup?: Record<string, unknown>,
  opts?: TelegramUserSendOptions,
): Promise<void> {
  await sendTelegramToUserChecked(telegramId, text, messageThreadId, replyMarkup, opts);
}

type TicketReplyConfig = Parameters<typeof mailConfigFromSystem>[0] & {
  publicAppUrl?: string | null;
  serviceName?: string | null;
};

type TicketReplyDeliveryDeps = {
  sendTelegram: typeof sendTelegramToUser;
  renderEmail: typeof renderEmailTemplate;
  sendMail: (config: SmtpConfig, to: string, subject: string, body: string) => Promise<{ ok: boolean; error?: string }>;
};

export async function deliverSupportReplyToClient(
  params: {
    client: { id: string; telegramId: string | null; email: string | null };
    ticket: { id: string; subject: string };
    content: string;
    attachmentsCount?: number;
    config: TicketReplyConfig;
  },
  deps: TicketReplyDeliveryDeps = {
    sendTelegram: sendTelegramToUser,
    renderEmail: renderEmailTemplate,
    sendMail: sendEmail,
  },
): Promise<{ telegram: boolean; email: boolean }> {
  const baseUrl = (params.config.publicAppUrl || "").replace(/\/+$/, "");
  const ticketUrl = baseUrl ? `${baseUrl}/cabinet/tickets` : "";
  const fallback = params.attachmentsCount ? "В ответе прикреплены файлы." : "Получен новый ответ.";
  const preview = params.content || fallback;
  const telegramPreview = preview.length > 3000 ? `${preview.slice(0, 2997)}...` : preview;
  const telegramText = [
    "💬 <b>Новый ответ в тикете</b>",
    "",
    `📋 ${escapeHtml(params.ticket.subject)}`,
    "",
    escapeHtml(telegramPreview),
  ].join("\n");
  const replyMarkup = ticketUrl
    ? { inline_keyboard: [[{ text: "🎫 Открыть тикеты", url: ticketUrl }]] }
    : undefined;

  let telegram = false;
  let email = false;
  await Promise.all([
    params.client.telegramId
      ? deps.sendTelegram(params.client.telegramId, telegramText, null, replyMarkup, { clientIdForBotToken: params.client.id })
          .then(() => { telegram = true; })
          .catch((error) => console.warn("[Ticket reply] Telegram notification failed", error))
      : Promise.resolve(),
    (async () => {
      if (!params.client.email) return;
      const mailConfig = mailConfigFromSystem(params.config);
      if (!isMailConfigured(mailConfig)) return;
      const template = await deps.renderEmail("ticket_reply", {
        ticketSubject: escapeHtml(params.ticket.subject),
        replyPreview: escapeHtml(preview),
        ticketUrl,
        serviceName: escapeHtml(params.config.serviceName || "Лазейка ВПН"),
      });
      if (!template) return;
      const result = await deps.sendMail(mailConfig, params.client.email, template.subject, template.body);
      email = result.ok;
      if (!result.ok) console.warn("[Ticket reply] Email notification failed", result.error);
    })().catch((error) => console.warn("[Ticket reply] Email notification failed", error)),
  ]);
  return { telegram, email };
}

export function getTopicIdForEvent(config: Record<string, unknown>, eventType: AdminNotificationEventType): number | null {
  let raw: string | null = null;
  switch (eventType) {
    case "new_client":
      raw = (config.notificationTopicNewClients as string) ?? null;
      break;
    case "balance_topup":
    case "tariff_payment":
      raw = (config.notificationTopicPayments as string) ?? null;
      break;
    case "new_ticket":
      raw = (config.notificationTopicTickets as string) ?? null;
      break;
    case "trial_activated":
      raw = (config.notificationTopicTrials as string) ?? null;
      break;
    case "subscription_converted":
      raw = (config.notificationTopicConversions as string) ?? null;
      break;
    case "withdrawal_request":
      raw = (config.notificationTopicWithdrawals as string) ?? null;
      break;
    case "promo_activated":
      raw = (config.notificationTopicPromo as string) ?? null;
      break;
    case "gift_redeemed":
      raw = (config.notificationTopicGifts as string) ?? null;
      break;
    case "auto_renew_failed":
      raw = (config.notificationTopicAutoRenew as string) ?? null;
      break;
    case "subscription_revoked":
      raw = (config.notificationTopicSubscriptionRevoked as string) ?? null;
      break;
  }
  if (!raw?.trim()) return null;
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function sendTelegramToAdminsForEvent(eventType: AdminNotificationEventType, text: string): Promise<void> {
  const config = await getSystemConfig();
  // ── manager-notify дубль new_ticket в отдельную группу менеджеров.
  // Группу читаем напрямую из systemSetting (не через allowlist getSystemConfig) — устойчивее к пересборкам.
  if (eventType === "new_ticket") {
    try {
      const mg = await prisma.systemSetting.findFirst({ where: { key: "notification_managers_group_id" } });
      const managersGroupId = mg?.value?.trim();
      if (managersGroupId) {
        const tp = await prisma.systemSetting.findFirst({ where: { key: "notification_managers_topic_tickets" } });
        const tpNum = tp?.value?.trim() ? parseInt(tp.value.trim(), 10) : NaN;
        const managersTopicId = Number.isFinite(tpNum) ? tpNum : undefined;
        await sendTelegramToUser(managersGroupId, text, managersTopicId).catch((e) => {
          console.warn("[Telegram notify] send to managers group failed", e);
        });
      }
    } catch (e) {
      console.warn("[Telegram notify] managers-group lookup failed", e);
    }
  }
  const groupId = config.notificationTelegramGroupId?.trim();
  if (groupId) {
    const topicId = getTopicIdForEvent(config as unknown as Record<string, unknown>, eventType);
    await sendTelegramToUser(groupId, text, topicId).catch((e) => {
      console.warn("[Telegram notify] send to group failed", e);
    });
    return;
  }
  const adminIds = config.botAdminTelegramIds ?? [];
  if (!adminIds.length) return;
  const prefs = (await prisma.adminNotificationPreference.findMany({
    where: { telegramId: { in: adminIds } },
  })) as AdminNotificationPreferenceRow[];
  const byId = new Map<string, AdminNotificationPreferenceRow>(prefs.map((p) => [p.telegramId, p]));
  const shouldSend = (telegramId: string) => {
    const p = byId.get(telegramId);
    if (!p) return true;
    switch (eventType) {
      case "balance_topup":
        return p.notifyBalanceTopup;
      case "tariff_payment":
        return p.notifyTariffPayment;
      case "new_client":
        return p.notifyNewClient;
      case "new_ticket":
        return p.notifyNewTicket;
      default:
        return true;
    }
  };
  await Promise.all(
    adminIds
      .filter((id) => shouldSend(id))
      .map((id) =>
        sendTelegramToUser(id, text).catch((e) => {
          console.warn("[Telegram notify] send to admin failed", e);
        })
      )
  );
}

/** Отправить техническую ошибку в ту же группу, куда уже приходят уведомления админки. */
export async function notifyAdminsAboutError(text: string): Promise<void> {
  await sendTelegramToAdminsForEvent("error", text);
}

function formatMoney(amount: number, currency: string): string {
  const curr = (currency || "RUB").toUpperCase();
  if (curr === "RUB") return `${amount.toFixed(2)} ₽`;
  if (curr === "USD") return `$${amount.toFixed(2)}`;
  return `${amount.toFixed(2)} ${curr}`;
}

export type TariffAdminNotificationData = {
  isAdminGrant: boolean;
  clientLabel: string;
  telegramId?: string | null;
  tariffName: string;
  durationDays?: number | null;
  amount?: number | null;
  currency?: string | null;
  provider?: string | null;
  /** Продление существующей подписки (extendsSecondarySubId) — меняет заголовок. */
  isRenewal?: boolean;
  /** Доп. устройства, выбранные при покупке (payment.deviceCount). */
  deviceCount?: number | null;
  /** Человекочитаемый метод оплаты (например, «СБП» / «Карты РФ» для Platega). */
  paymentMethodLabel?: string | null;
  date: Date;
};

export function buildTariffAdminNotificationText(data: TariffAdminNotificationData): string {
  const title = data.isAdminGrant
    ? `🎁 <b>Администратор выдал подписку</b>`
    : data.isRenewal
      ? `🔄 <b>Продление тарифа</b>`
      : `📦 <b>Оплата тарифа</b>`;
  const lines = [
    title,
    ``,
    `👤 Клиент: ${escapeHtml(data.clientLabel)}`,
  ];
  if (data.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(data.telegramId)}</code>`);
  lines.push(`📋 Тариф: <b>${escapeHtml(data.tariffName)}</b>`);
  if (data.durationDays) lines.push(`📅 Срок: ${data.durationDays} дн.`);
  if (data.deviceCount != null && data.deviceCount > 0) lines.push(`📱 Доп. устройства: <b>${data.deviceCount}</b>`);
  if (!data.isAdminGrant && data.amount != null) lines.push(`💵 Сумма: <b>${formatMoney(data.amount, data.currency ?? "RUB")}</b>`);
  if (!data.isAdminGrant && data.provider) {
    const methodSuffix = data.paymentMethodLabel ? ` · ${escapeHtml(data.paymentMethodLabel)}` : "";
    lines.push(`🏦 Провайдер: ${escapeHtml(data.provider)}${methodSuffix}`);
  }
  lines.push(`🕐 ${formatDate(data.date)}`);
  return lines.join("\n");
}

export function formatPartnerNotificationLine(partner: {
  email?: string | null;
  telegramUsername?: string | null;
  telegramId?: string | null;
  id?: string;
}): string {
  const details = partner.telegramId ? ` (TG ID: ${partner.telegramId})` : "";
  return `🤝 Партнёр: ${escapeHtml(formatClientLabel(partner))}${details}`;
}

/**
 * Отправить уведомление о пополнении баланса.
 */
export async function notifyBalanceToppedUp(clientId: string, amount: number, currency: string, provider?: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true, email: true, telegramUsername: true, id: true, balance: true },
  });
  if (!client) return;
  if (client.telegramId) {
    const textForClient = `✅ <b>Баланс пополнен</b> на ${formatMoney(amount, currency)}.\nВаш баланс: ${formatMoney(client.balance ?? 0, currency)}`;
    const config = await getSystemConfig();
    await sendTelegramToUser(client.telegramId, textForClient, null, backToMenuMarkup(config.botBackLabel), {
      clientIdForBotToken: client.id,
    });
  }
  const clientLabel = formatClientLabel(client);
  const lines = [
    `💰 <b>Пополнение баланса</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(clientLabel)}`,
  ];
  if (client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  lines.push(`💵 Сумма: <b>${formatMoney(amount, currency)}</b>`);
  lines.push(`💰 Баланс после: ${formatMoney(client.balance ?? 0, currency)}`);
  if (provider) lines.push(`🏦 Провайдер: ${escapeHtml(provider)}`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("balance_topup", lines.join("\n"));
}

/**
 * Отправить уведомление об оплате и активации тарифа.
 */
export async function notifyTariffActivated(clientId: string, paymentId: string): Promise<boolean> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true, email: true, telegramUsername: true, id: true, balance: true },
  });
  if (!client) return false;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      amount: true,
      currency: true,
      provider: true,
      subscriptionId: true,
      tariffId: true,
      metadata: true,
      deviceCount: true,
      tariff: { select: { name: true, durationDays: true, price: true, locations: true, trafficLimitBytes: true } },
      tariffPriceOption: { select: { durationDays: true } },
    },
  });
  const tariffName = payment?.tariff?.name?.trim() || "Тариф";
  let clientNotificationDelivered = !client.telegramId;
  // если оплачена подарочная подписка — автогенерируем GiftCode
  // и шлём клиенту текст по ТЗ (Стандарт / Unblock с трафиком) с готовой ссылкой.
  // если выдан админом — меняем заголовок «Тариф ... оплачен и активирован»
  // на «Администратор выдал Вам подписку Тариф «...»».
  // админский комментарий — показываем клиенту в уведомлении.
  let isGiftPurchase = false;
  let isAdminGrant = false;
  let adminNote: string | null = null;
  let isRenewal = false;
  let plategaMethodId: number | null = null;
  try {
    const meta = payment?.metadata ? JSON.parse(payment.metadata) as Record<string, unknown> : null;
    isGiftPurchase = meta?.purchasedAsGift === true;
    isAdminGrant = meta?.kind === "admin_grant";
    isRenewal = typeof meta?.extendsSecondarySubId === "string" && meta.extendsSecondarySubId.length > 0;
    if (typeof meta?.plategaMethodId === "number" && Number.isFinite(meta.plategaMethodId)) {
      plategaMethodId = meta.plategaMethodId;
    }
    if (typeof meta?.note === "string" && meta.note.trim()) {
      adminNote = meta.note.trim();
    }
  } catch { /* ignore */ }

  if (client.telegramId && isGiftPurchase && payment?.subscriptionId) {
    // Авто-создание gift code сразу после оплаты.
    try {
      const { createGiftCode } = await import("../gift/gift.service.js");
      const codeResult = await createGiftCode(clientId, payment.subscriptionId, undefined, { skipConfigCheck: true });
      if (codeResult.ok) {
        const cfg = await getSystemConfig();
        const botToken = (cfg.telegramBotToken || "").trim();
        const botUsernameRes = botToken
          ? await fetch(`https://api.telegram.org/bot${botToken}/getMe`).then((r) => r.json() as Promise<{ ok: boolean; result?: { username?: string } }>).catch(() => null)
          : null;
        const botUsername = botUsernameRes?.result?.username ?? "bot";
        const giftUrl = `https://t.me/${botUsername}?start=gift_${codeResult.data.code}`;
        const durationDays = codeResult.data.durationDays ?? payment.tariff?.durationDays ?? 0;
        const trafficBytes = codeResult.data.trafficLimitBytes ?? (payment.tariff?.trafficLimitBytes != null ? Number(payment.tariff.trafficLimitBytes) : 0);
        const hasTraffic = trafficBytes > 0;
        let giftText: string;
        if (hasTraffic) {
          const trafficGb = Math.round(trafficBytes / 1024 ** 3);
          giftText =
            `💝 Подарочная ${tariffName} готова!\n\n` +
            `✅ Оплата прошла успешно.\n📅 ${durationDays} дней, ${trafficGb} GB\n\n` +
            `👉 Перешлите ссылку человеку, которому хотите подарить подписку ⬇️\n\n` +
            `💡 Чтобы скопировать ссылку, нажмите на неё один раз.\n\n` +
            `${giftUrl}\n\n` +
            `🎉 При переходе по ссылке подписка автоматически активируется!`;
        } else {
          giftText =
            `💝 Подарочная подписка готова!\n\n` +
            `✅ Оплата прошла успешно.\nКод: ${codeResult.data.code}\nТариф: ${tariffName}\n📅 ${durationDays} дней\n\n` +
            `👉 Перешлите ссылку человеку, которому хотите подарить подписку ⬇️\n\n` +
            `${giftUrl}\n\n` +
            `🎉 При переходе по ссылке подписка автоматически активируется!`;
        }
        // `?url=` обязателен — иначе share-окно не открывается.
        // новый текст шеринга подарка.
        const shareText = `У меня для тебя подарок 🎁\n \nПодписка на сервис безопасного удалённого доступа 🛡 \n\n💡 Нажми на ссылку, чтобы активировать:\n\n${giftUrl}`;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(giftUrl)}&text=${encodeURIComponent(shareText)}`;
        if (botToken) {
          const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: client.telegramId,
              text: giftText,
              reply_markup: {
                inline_keyboard: [
                  [{ text: "📤 Поделиться в Telegram", url: shareUrl }],
                  [{ text: "🎁 Мои подарки", callback_data: "gift:subscriptions" }],
                  [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
                ],
              },
            }),
          });
          const result = await response.json().catch(() => ({})) as { ok?: boolean };
          clientNotificationDelivered = response.ok && result.ok !== false;
        }
      }
    } catch (e) {
      console.error("[notify] gift purchase auto-create failed:", e);
    }
    // Для подарочной не шлём «Тариф оплачен и активирован» — клиент получил красивый gift-текст выше.
    // Админ-уведомление шлётся в конце функции в любом случае.
  } else if (client.telegramId) {
    // после успешной оплаты — выдаём ту же UX что после триала:
    // ссылка подписки + кнопки «📲 Инструкции по установке» и «🌐 Локации» (если есть).
    let subscriptionUrl: string | null = null;
    if (payment?.subscriptionId) {
      const sub = await prisma.subscription.findUnique({
        where: { id: payment.subscriptionId },
        select: { remnawaveUuid: true },
      });
      if (sub?.remnawaveUuid) {
        const result = await remnaGetUser(sub.remnawaveUuid);
        subscriptionUrl = extractRemnaSubscriptionUrl(result.data);
      }
    }
    const cfg = await getSystemConfig();
    // подсказка «если инструкция не открылась»
    // (платная/админская подписка). Текст из настроек (Тексты бота) или дефолт.
    const instrFallback = ((cfg as { botInstructionFallbackText?: string | null }).botInstructionFallbackText ?? "").trim()
      || "💡 Если инструкции не открываются: скопируйте ссылку подписки и вставьте её в приложение Happ вручную или обратитесь в поддержку.";
    const linkBlock = subscriptionUrl
      ? `\n\n🔗 Ссылка подписки:\n${subscriptionUrl}\n\nДля подключения нажмите кнопку «📲 Инструкции по установке»:\n\n${instrFallback}`
      : "";
    // два заголовка в зависимости от источника подписки.
    const headline = isAdminGrant
      ? `✅ Администратор выдал Вам подписку Тариф «<b>${escapeHtml(tariffName)}</b>»`
      : `✅ <b>Тариф «${escapeHtml(tariffName)}»</b> оплачен и активирован`;
    // если админ оставил комментарий — показываем клиенту.
    const noteBlock = (isAdminGrant && adminNote)
      ? `\n\n💬 <i>${escapeHtml(adminNote)}</i>`
      : "";
    const trialToTariff = !isAdminGrant && isTrialToTariffPayment(payment?.metadata ?? null);
    const updateBlock = trialToTariff ? `\n\n${SUBSCRIPTION_UPDATE_TEXT}` : "";
    const textClient = `${headline}.${noteBlock}${linkBlock}${updateBlock}`;
    const hasLocations = !!(payment?.tariff?.locations?.trim());
    type Row = ({ text: string; callback_data: string } | { text: string; url: string })[];
    const rows: Row[] = [];
    if (subscriptionUrl) rows.push([{ text: "📲 Инструкции по установке", url: subscriptionUrl }]);
    if (hasLocations && payment?.tariffId) {
      rows.push([{ text: "🌐 Локации", callback_data: `menu:locations:${payment.tariffId}` }]);
    }
    rows.push([{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }]);
    rows.push([{ text: cfg.botBackLabel ?? "🏠 Главное меню", callback_data: "menu:main" }]);
    const sent = await sendTelegramToUserChecked(client.telegramId, textClient, null, { inline_keyboard: rows }, {
      clientIdForBotToken: clientId,
    });
    clientNotificationDelivered = sent;
    const botToken = cfg.telegramBotToken?.trim();
    if (trialToTariff && botToken) await sendSubscriptionUpdateGuides(client.telegramId, botToken);
  }
  const durationDays = payment?.tariffPriceOption?.durationDays ?? payment?.tariff?.durationDays;
  // Метод оплаты: label из настроек Platega, иначе — известные id.
  let paymentMethodLabel: string | null = null;
  if (plategaMethodId != null) {
    const notifyCfg = await getSystemConfig();
    paymentMethodLabel = notifyCfg.plategaMethods?.find((m) => m.id === plategaMethodId)?.label
      ?? PLATEGA_METHOD_FALLBACK_LABELS[plategaMethodId]
      ?? null;
  }
  await sendTelegramToAdminsForEvent("tariff_payment", buildTariffAdminNotificationText({
    isAdminGrant,
    clientLabel: formatClientLabel(client),
    telegramId: client.telegramId,
    tariffName,
    durationDays,
    amount: payment?.amount,
    currency: payment?.currency,
    provider: payment?.provider,
    isRenewal,
    deviceCount: payment?.deviceCount,
    paymentMethodLabel,
    date: new Date(),
  }));
  return clientNotificationDelivered;
}

/**
 * алерт админам: платёж прошёл, а активация тарифа УПАЛА.
 * Раньше в этом случае админ-группа получала обычное «📦 Оплата тарифа», клиент —
 * «активирован», и проблема всплывала только когда клиент приходил в саппорт.
 */
export async function notifyTariffActivationFailed(clientId: string, paymentId: string, error: string): Promise<void> {
  if (!await shouldNotifyPlategaError(paymentId, "activation_failed", error, paymentId)) return;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true, email: true, telegramUsername: true, id: true },
  });
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { amount: true, currency: true, provider: true, tariff: { select: { name: true } } },
  });
  const lines = [
    `🚨 <b>Оплата прошла, но активация тарифа УПАЛА</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(client ? formatClientLabel(client) : clientId)}`,
  ];
  if (client?.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  if (payment?.tariff?.name) lines.push(`📋 Тариф: <b>${escapeHtml(payment.tariff.name)}</b>`);
  if (payment?.amount != null) lines.push(`💵 Сумма: <b>${formatMoney(payment.amount, payment.currency ?? "RUB")}</b>`);
  if (payment?.provider) lines.push(`🏦 Провайдер: ${escapeHtml(payment.provider)}`);
  lines.push(`❌ Ошибка: <code>${escapeHtml(error.slice(0, 300))}</code>`);
  lines.push(`🧾 Payment: <code>${escapeHtml(paymentId)}</code>`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("tariff_payment", lines.join("\n"));
}

export async function notifyPlategaPaymentEvent(params: {
  kind: "canceled" | "callback_failed" | "service_issued" | "recovered";
  paymentId?: string | null;
  transactionId?: string | null;
  details?: string;
  callbackAvailable?: boolean;
}): Promise<void> {
  if (params.kind === "callback_failed") {
    const identity = params.paymentId ?? params.transactionId ?? "anonymous";
    if (!await shouldNotifyPlategaError(params.paymentId, params.kind, params.details ?? "unknown", identity)) return;
  }
  const titles = {
    canceled: "⛔️ Платёж Platega отменён",
    callback_failed: "🚨 Callback Platega не обработан",
    service_issued: "✅ Оплата Platega обработана, услуга выдана",
    recovered: "🔄 Платёж Platega восстановлен сверкой",
  } as const;
  const payment = params.paymentId ? await prisma.payment.findUnique({
    where: { id: params.paymentId },
    select: {
      amount: true,
      currency: true,
      client: { select: { id: true, email: true, telegramId: true, telegramUsername: true } },
    },
  }) : null;
  const lines = [`<b>${titles[params.kind]}</b>`, ``];
  if (payment?.client) lines.push(`👤 Клиент: ${escapeHtml(formatClientLabel(payment.client))}`);
  if (payment?.client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(payment.client.telegramId)}</code>`);
  if (payment) lines.push(`💵 Сумма: <b>${formatMoney(payment.amount, payment.currency)}</b>`);
  if (params.paymentId) lines.push(`🧾 Payment: <code>${escapeHtml(params.paymentId)}</code>`);
  if (params.transactionId) lines.push(`🔗 Transaction: <code>${escapeHtml(params.transactionId)}</code>`);
  if (params.details) lines.push(`ℹ️ ${escapeHtml(params.details.slice(0, 500))}`);
  if (params.callbackAvailable != null) lines.push(`🌐 Callback: <b>${params.callbackAvailable ? "доступен" : "НЕДОСТУПЕН"}</b>`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("tariff_payment", lines.join("\n"));
}

/**
 * уведомление клиенту об успешной активации
 * extra-option (доп. устройства / трафик / серверы), после оплаты картой / криптой / etc.
 */
export async function notifyExtraOptionApplied(clientId: string, paymentId: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true },
  });
  if (!client?.telegramId) return;
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { amount: true, currency: true, metadata: true, provider: true },
  });
  if (!payment) return;
  // Парсим extraOption.kind из metadata.
  let kind: "traffic" | "devices" | "servers" | null = null;
  try {
    const meta = payment.metadata ? JSON.parse(payment.metadata) as { extraOption?: { kind?: string } } : null;
    const k = meta?.extraOption?.kind;
    if (k === "traffic" || k === "devices" || k === "servers") kind = k;
  } catch { /* ignore */ }

  // Текст по типу опции. verb согласован с родом title-а.
  let title: string;
  let verb: string;
  if (kind === "traffic") { title = "Дополнительный трафик"; verb = "добавлен"; }
  else if (kind === "devices") { title = "Дополнительное устройство"; verb = "добавлено"; }
  else if (kind === "servers") { title = "Дополнительный сервер"; verb = "добавлен"; }
  else { title = "Дополнительная опция"; verb = "добавлена"; }

  const amount = payment.amount ?? 0;
  const currency = (payment.currency ?? "RUB").toUpperCase();
  const lines = [
    `✅ <b>${escapeHtml(title)}</b> успешно ${verb} к вашей подписке.`,
  ];
  if (amount > 0) lines.push(`💵 Списано: <b>${formatMoney(amount, currency)}</b>`);
  lines.push("", "Изменения вступили в силу мгновенно — можете пользоваться.");

  const cfg = await getSystemConfig();
  const botToken = cfg.telegramBotToken?.trim();
  if (!botToken) return;
  const replyMarkup = {
    inline_keyboard: [
      [{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }],
      [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
    ],
  };
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: client.telegramId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    }),
  }).catch((e) => console.error("[notifyExtraOptionApplied] send failed:", e));
}

/** Человекочитаемый маркер «к сообщению приложены фото». */
function attachmentsBadge(count?: number): string {
  if (!count || count <= 0) return "";
  return count === 1 ? " 📷" : ` 📷 ×${count}`;
}

export async function notifyAdminsAboutNewTicket(params: {
  ticketId: string;
  clientId: string;
  subject: string;
  firstMessage: string;
  attachmentsCount?: number;
}): Promise<void> {
  const [client, ticket] = await Promise.all([
    prisma.client.findUnique({
      where: { id: params.clientId },
      select: { email: true, telegramId: true, telegramUsername: true, id: true },
    }),
    prisma.ticket.findUnique({
      where: { id: params.ticketId },
      select: { id: true, subject: true, status: true },
    }),
  ]);
  if (!ticket) return;
  const config = await getSystemConfig();
  const clientLabel = formatClientLabel(client ?? { id: params.clientId });
  const baseUrl = (config.publicAppUrl || "").replace(/\/+$/, "");
  const attachmentsHint = attachmentsBadge(params.attachmentsCount);
  const previewBody = params.firstMessage || (attachmentsHint ? "(только фото)" : "");
  const preview =
    previewBody.length > 200 ? `${previewBody.slice(0, 197)}...` : previewBody;
  const lines = [
    `🆕 <b>Новый тикет</b>${attachmentsHint}`,
    ``,
    `📋 Тема: <b>${escapeHtml(ticket.subject)}</b>`,
    `👤 Клиент: ${escapeHtml(clientLabel)}`,
  ];
  if (client?.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  lines.push(``, `💬 ${escapeHtml(preview)}`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  if (baseUrl) lines.push(`\n🔗 <a href="${escapeHtml(`${baseUrl}/admin/tickets`)}">Открыть в админке</a>`);
  await sendTelegramToAdminsForEvent("new_ticket", lines.join("\n"));
}

export async function notifyAdminsAboutClientTicketMessage(params: {
  ticketId: string;
  clientId: string;
  content: string;
  attachmentsCount?: number;
}): Promise<void> {
  const [client, ticket] = await Promise.all([
    prisma.client.findUnique({
      where: { id: params.clientId },
      select: { email: true, telegramId: true, telegramUsername: true, id: true },
    }),
    prisma.ticket.findUnique({
      where: { id: params.ticketId },
      select: { id: true, subject: true, status: true },
    }),
  ]);
  if (!ticket) return;
  const config = await getSystemConfig();
  const clientLabel = formatClientLabel(client ?? { id: params.clientId });
  const baseUrl = (config.publicAppUrl || "").replace(/\/+$/, "");
  const attachmentsHint = attachmentsBadge(params.attachmentsCount);
  const previewBody = params.content || (attachmentsHint ? "(только фото)" : "");
  const preview =
    previewBody.length > 200 ? `${previewBody.slice(0, 197)}...` : previewBody;
  const lines = [
    `💬 <b>Новое сообщение в тикете</b>${attachmentsHint}`,
    ``,
    `📋 Тема: <b>${escapeHtml(ticket.subject)}</b>`,
    `👤 Клиент: ${escapeHtml(clientLabel)}`,
    ``,
    `${escapeHtml(preview)}`,
    `🕐 ${formatDate(new Date())}`,
  ];
  if (baseUrl) lines.push(`\n🔗 <a href="${escapeHtml(`${baseUrl}/admin/tickets`)}">Открыть в админке</a>`);
  await sendTelegramToAdminsForEvent("new_ticket", lines.join("\n"));
}

export async function notifyAdminsAboutSupportReply(params: {
  ticketId: string;
  clientId: string;
  content: string;
  attachmentsCount?: number;
}): Promise<void> {
  const [client, ticket] = await Promise.all([
    prisma.client.findUnique({
      where: { id: params.clientId },
      select: { email: true, telegramId: true, telegramUsername: true, id: true },
    }),
    prisma.ticket.findUnique({
      where: { id: params.ticketId },
      select: { id: true, subject: true, status: true },
    }),
  ]);
  if (!ticket) return;
  const config = await getSystemConfig();
  const clientLabel = formatClientLabel(client ?? { id: params.clientId });
  const baseUrl = (config.publicAppUrl || "").replace(/\/+$/, "");
  const attachmentsHint = attachmentsBadge(params.attachmentsCount);
  const previewBody = params.content || (attachmentsHint ? "(только фото)" : "");
  const preview =
    previewBody.length > 200 ? `${previewBody.slice(0, 197)}...` : previewBody;
  const lines = [
    `✅ <b>Ответ поддержки в тикете</b>${attachmentsHint}`,
    ``,
    `📋 Тема: <b>${escapeHtml(ticket.subject)}</b>`,
    `👤 Клиент: ${escapeHtml(clientLabel)}`,
    ``,
    `${escapeHtml(preview)}`,
    `🕐 ${formatDate(new Date())}`,
  ];
  if (baseUrl) lines.push(`\n🔗 <a href="${escapeHtml(`${baseUrl}/admin/tickets`)}">Открыть в админке</a>`);
  await Promise.all([
    sendTelegramToAdminsForEvent("new_ticket", lines.join("\n")),
    client ? deliverSupportReplyToClient({
      client,
      ticket,
      content: params.content,
      attachmentsCount: params.attachmentsCount,
      config,
    }) : Promise.resolve(),
  ]);
}

export async function notifyAdminsAboutTicketStatusChange(params: {
  ticketId: string;
  clientId: string;
  subject: string;
  status: string;
}): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: params.clientId },
    select: { email: true, telegramId: true, telegramUsername: true, id: true },
  });
  const config = await getSystemConfig();
  const clientLabel = formatClientLabel(client ?? { id: params.clientId });
  const baseUrl = (config.publicAppUrl || "").replace(/\/+$/, "");
  const statusLabel = params.status === "closed" ? "🔴 Закрыт" : "🟢 Открыт";
  const lines = [
    `ℹ️ <b>Статус тикета изменён</b>`,
    ``,
    `📋 Тема: <b>${escapeHtml(params.subject)}</b>`,
    `👤 Клиент: ${escapeHtml(clientLabel)}`,
    `📌 Статус: <b>${statusLabel}</b>`,
    `🕐 ${formatDate(new Date())}`,
  ];
  if (baseUrl) lines.push(`\n🔗 <a href="${escapeHtml(`${baseUrl}/admin/tickets`)}">Открыть в админке</a>`);
  await sendTelegramToAdminsForEvent("new_ticket", lines.join("\n"));
}

export async function notifyAdminsAboutNewClient(clientId: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      email: true,
      telegramId: true,
      telegramUsername: true,
      createdAt: true,
      referrer: { select: { id: true, email: true, telegramId: true, telegramUsername: true } },
    },
  });
  if (!client) return;
  const config = await getSystemConfig();
  const baseUrl = (config.publicAppUrl || "").replace(/\/+$/, "");
  const clientLabel = formatClientLabel(client);
  const totalClients = await prisma.client.count().catch(() => null);
  const lines = [
    `👤 <b>Новый клиент</b>`,
    ``,
    `📝 ${escapeHtml(clientLabel)}`,
  ];
  if (client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  if (client.telegramUsername) lines.push(`📱 Username: @${escapeHtml(client.telegramUsername)}`);
  if (client.email) lines.push(`📧 Email: ${escapeHtml(client.email)}`);
  if (client.referrer) lines.push(formatPartnerNotificationLine(client.referrer));
  if (totalClients != null) lines.push(`📊 Всего клиентов: <b>${totalClients}</b>`);
  lines.push(`🕐 ${formatDate(client.createdAt)}`);
  if (baseUrl) lines.push(`\n🔗 <a href="${escapeHtml(`${baseUrl}/admin/clients`)}">Открыть в админке</a>`);
  await sendTelegramToAdminsForEvent("new_client", lines.join("\n"));
}

/**
 * уведомление админам о новой заявке на вывод реф. баланса.
 */
export async function notifyAdminsAboutWithdrawal(withdrawalId: string): Promise<void> {
  const wr = await prisma.withdrawalRequest.findUnique({
    where: { id: withdrawalId },
    include: { client: { select: { id: true, telegramId: true, telegramUsername: true, email: true } } },
  });
  if (!wr) return;
  const config = await getSystemConfig();
  const baseUrl = (config.publicAppUrl || "").replace(/\/+$/, "");
  const clientLabel = formatClientLabel(wr.client);
  const lines = [
    `💰 <b>Заявка на вывод (USDT TRC20)</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(clientLabel)}`,
  ];
  if (wr.client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(wr.client.telegramId)}</code>`);
  lines.push(`💸 Сумма: <b>${wr.amount.toFixed(2)} ₽</b>`);
  lines.push(`🏦 Кошелёк TRC20: <code>${escapeHtml(wr.walletTrc20)}</code>`);
  lines.push(`🕐 ${formatDate(wr.createdAt)}`);
  if (baseUrl) lines.push(`\n🔗 <a href="${escapeHtml(`${baseUrl}/admin/withdrawals`)}">Открыть в админке</a>`);
  await sendTelegramToAdminsForEvent("withdrawal_request", lines.join("\n"));
}

/**
 * уведомление админам: клиент активировал пробный период.
 */
export async function notifyAdminsAboutTrialActivated(clientId: string, trialName: string, durationDays: number): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true },
  });
  if (!client) return;
  const lines = [
    `🎁 <b>Активирован пробный период</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(formatClientLabel(client))}`,
  ];
  if (client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  lines.push(`📋 Триал: <b>${escapeHtml(trialName)}</b>`);
  lines.push(`📅 Срок: ${durationDays} дн.`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("trial_activated", lines.join("\n"));
}

/** Напоминание клиенту незадолго до окончания пробного периода. */
export const DEFAULT_TRIAL_EXPIRY_TEXT =
  "⏳ <b>Пробный период скоро закончится</b>\n\nТриал «{{name}}» закончится примерно через <b>{{time}}</b>.\nВыберите тариф, чтобы сохранить доступ к VPN.";
export const DEFAULT_SUBSCRIPTION_EXPIRY_TEXT =
  "⏳ <b>Подписка скоро закончится</b>\n\nТариф «{{name}}» закончится примерно через <b>{{time}}</b>.\nПродлите подписку, чтобы сохранить доступ к VPN.";

export function renderExpiryReminderText(template: string, name: string, minutesLeft: number): string {
  const hours = minutesLeft / 60;
  const time = minutesLeft >= 60
    ? `${Number.isInteger(hours) ? hours : Number(hours.toFixed(1))} ч.`
    : `${minutesLeft} мин.`;
  return template.replaceAll("{{name}}", escapeHtml(name)).replaceAll("{{time}}", time);
}

export async function notifyTrialExpiry(
  telegramId: string,
  trialName: string,
  minutesLeft: number,
  text = DEFAULT_TRIAL_EXPIRY_TEXT,
  buttonText = "💳 Выбрать тариф",
): Promise<boolean> {
  const renderedText = renderExpiryReminderText(text, trialName, minutesLeft);
  const delivered = await sendTelegramToUserChecked(
    telegramId,
    renderedText,
    undefined,
    subscriptionExpiryMarkup(buttonText),
  );
  console[delivered ? "info" : "warn"]("[expiry reminder] Telegram trial notification", {
    delivered,
    recipient: telegramId,
    minutesLeft,
    sentAt: new Date().toISOString(),
    text: renderedText,
  });
  return delivered;
}

/** Напоминание клиенту незадолго до окончания оплаченной подписки. */
export async function notifySubscriptionExpiry(
  telegramId: string,
  subscriptionId: string,
  tariffName: string,
  minutesLeft: number,
  text = DEFAULT_SUBSCRIPTION_EXPIRY_TEXT,
  buttonText = "💳 Продлить подписку",
): Promise<boolean> {
  const renderedText = renderExpiryReminderText(text, tariffName, minutesLeft);
  const delivered = await sendTelegramToUserChecked(
    telegramId,
    renderedText,
    undefined,
    subscriptionExpiryMarkup(buttonText, `pay_tariff_ext:${subscriptionId}`),
  );
  console[delivered ? "info" : "warn"]("[expiry reminder] Telegram subscription notification", {
    delivered,
    recipient: telegramId,
    subscriptionId,
    minutesLeft,
    sentAt: new Date().toISOString(),
    text: renderedText,
  });
  return delivered;
}

/**
 * уведомление админам: покупка конвертировала существующую подписку
 * (режим «одна подписка из категории» — смена тарифа с pro-rata конвертацией остатка).
 */
export async function notifyAdminsAboutSubscriptionConverted(
  clientId: string,
  oldTariffName: string | null,
  newTariffName: string,
  convertedDays?: number | null,
): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true },
  });
  if (!client) return;
  const lines = [
    `🔄 <b>Конвертация подписки</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(formatClientLabel(client))}`,
  ];
  if (client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  lines.push(`📋 Тариф: <b>${escapeHtml(oldTariffName?.trim() || "—")}</b> → <b>${escapeHtml(newTariffName)}</b>`);
  if (convertedDays != null && convertedDays > 0) lines.push(`📅 Конвертировано дней: <b>+${convertedDays}</b>`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("subscription_converted", lines.join("\n"));
}

/** Уведомить владельца и служебный Telegram-канал после полного отзыва одной логической подписки. */
export async function notifySubscriptionRevoked(params: {
  clientId: string;
  subscriptionId: string;
  subscriptionIndex: number;
}): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: params.clientId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true },
  });
  if (!client) return;

  const subscriptionLabel = `Подписка №${params.subscriptionIndex}`;
  if (client.telegramId) {
    await sendTelegramToUser(
      client.telegramId,
      `⛔ <b>${escapeHtml(subscriptionLabel)} аннулирована</b>\n\nДоступ по этой подписке отключён. Остальные ваши подписки не изменены.`,
      undefined,
      backToMenuMarkup(),
    );
  }

  const lines = [
    `⛔ <b>Подписка аннулирована</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(formatClientLabel(client))}`,
    `📋 ${escapeHtml(subscriptionLabel)}`,
    `🆔 Subscription: <code>${escapeHtml(params.subscriptionId)}</code>`,
    `🕐 ${formatDate(new Date())}`,
  ];
  if (client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  await sendTelegramToAdminsForEvent("subscription_revoked", lines.join("\n"));
}

/** Уведомить служебный Telegram-канал, что отзыв ожидает повторной синхронизации. */
export async function notifySubscriptionRevokeFailed(params: {
  clientId: string;
  subscriptionId: string;
  subscriptionIndex: number;
  failures: Array<{ key: string; error: string }>;
}): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: params.clientId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true },
  });
  const failureLines = params.failures.slice(0, 5).map((failure) =>
    `• <b>${escapeHtml(failure.key)}</b>: ${escapeHtml(failure.error)}`,
  );
  await sendTelegramToAdminsForEvent("subscription_revoked", [
    `⚠️ <b>Отзыв подписки ожидает синхронизации</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(formatClientLabel(client ?? { id: params.clientId }))}`,
    `📋 Подписка №${params.subscriptionIndex}`,
    `🆔 Subscription: <code>${escapeHtml(params.subscriptionId)}</code>`,
    ...failureLines,
    `🕐 ${formatDate(new Date())}`,
  ].join("\n"));
}

/**
 * уведомление админам: активирован промокод FREE_DAYS.
 */
export async function notifyAdminsAboutPromoActivated(clientId: string, code: string, durationDays: number): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true },
  });
  if (!client) return;
  const lines = [
    `🏷 <b>Активирован промокод</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(formatClientLabel(client))}`,
  ];
  if (client.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  lines.push(`🎟 Код: <code>${escapeHtml(code)}</code>`);
  lines.push(`📅 Дней: <b>${durationDays}</b>`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("promo_activated", lines.join("\n"));
}

/**
 * уведомление админам: подарочный код активирован получателем.
 */
export async function notifyAdminsAboutGiftRedeemed(
  creatorClientId: string,
  recipientClientId: string,
  tariffName: string | null,
): Promise<void> {
  const [creator, recipient] = await Promise.all([
    prisma.client.findUnique({
      where: { id: creatorClientId },
      select: { id: true, email: true, telegramId: true, telegramUsername: true },
    }),
    prisma.client.findUnique({
      where: { id: recipientClientId },
      select: { id: true, email: true, telegramId: true, telegramUsername: true },
    }),
  ]);
  const lines = [
    `🎁 <b>Подарок активирован</b>`,
    ``,
    `👤 Даритель: ${escapeHtml(creator ? formatClientLabel(creator) : creatorClientId)} → Получатель: ${escapeHtml(recipient ? formatClientLabel(recipient) : recipientClientId)}`,
  ];
  if (recipient?.telegramId) lines.push(`🆔 TG ID получателя: <code>${escapeHtml(recipient.telegramId)}</code>`);
  if (tariffName?.trim()) lines.push(`📋 Тариф: <b>${escapeHtml(tariffName.trim())}</b>`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("gift_redeemed", lines.join("\n"));
}

/**
 * уведомление админам: автосписание провалилось (компенсация отработала, тариф не продлён).
 */
export async function notifyAdminsAboutAutoRenewFailed(clientId: string, tariffName: string, error: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true },
  });
  const lines = [
    `🚨 <b>Автосписание провалилось</b>`,
    ``,
    `👤 Клиент: ${escapeHtml(client ? formatClientLabel(client) : clientId)}`,
  ];
  if (client?.telegramId) lines.push(`🆔 TG ID: <code>${escapeHtml(client.telegramId)}</code>`);
  lines.push(`📋 Тариф: <b>${escapeHtml(tariffName)}</b>`);
  lines.push(`❌ Ошибка: <code>${escapeHtml(error.slice(0, 300))}</code>`);
  lines.push(`🕐 ${formatDate(new Date())}`);
  await sendTelegramToAdminsForEvent("auto_renew_failed", lines.join("\n"));
}

/**
 * уведомление клиенту что вывод средств выполнен.
 */
export async function notifyClientAboutWithdrawalApproved(withdrawalId: string): Promise<void> {
  const wr = await prisma.withdrawalRequest.findUnique({
    where: { id: withdrawalId },
    include: { client: { select: { id: true, telegramId: true } } },
  });
  if (!wr || !wr.client.telegramId) return;
  const text = [
    `✅ Заявка на вывод средств успешно исполнена.`,
    ``,
    `В течение 48 часов средства поступят на указанный Вами кошелёк.`,
    ``,
    `Благодарим за сотрудничество 🤝`,
  ].join("\n");
  // добавили кнопку «🏠 Главное меню» — чтобы клиент мог
  // одним кликом вернуться в бот после получения уведомления о выплате.
  const replyMarkup = {
    inline_keyboard: [
      [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
    ],
  };
  // Используем функцию sendTelegramMessage если есть, иначе через прямой fetch к Telegram API.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import("../bot/bot.service.js") as any;
    const sendFn = mod.sendTelegramMessage ?? mod.sendMessage;
    if (typeof sendFn === "function") {
      // Передаём reply_markup опциональным 3-м параметром — если функция не поддерживает,
      // он будет проигнорирован (но мы дублируем в fallback).
      await sendFn(wr.client.telegramId, text, { reply_markup: replyMarkup });
      return;
    }
  } catch {
    // ignore
  }
  // Фолбэк через Bot API напрямую.
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) return;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: wr.client.telegramId, text, reply_markup: replyMarkup }),
  }).catch(() => {});
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatClientLabel(client: { email?: string | null; telegramUsername?: string | null; id?: string }): string {
  if (client.telegramUsername) return `@${client.telegramUsername}`;
  if (client.email?.trim()) return client.email.trim();
  return client.id ?? "unknown";
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ") + " UTC";
}

/**
 * Отправить уведомление о создании прокси-слотов (после оплаты).
 */
export async function notifyProxySlotsCreated(clientId: string, slotIds: string[], tariffName?: string): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true, id: true } });
  if (!client?.telegramId || slotIds.length === 0) return;

  const slots = await prisma.proxySlot.findMany({
    where: { id: { in: slotIds } },
    select: { node: { select: { publicHost: true, socksPort: true, httpPort: true } }, login: true, password: true },
    orderBy: { createdAt: "asc" },
  });

  const name = tariffName?.trim() || "Прокси";
  let text = `✅ <b>Прокси «${escapeHtml(name)}»</b> оплачены.\n\n`;
  for (const s of slots) {
    const host = s.node.publicHost ?? "host";
    text += `• SOCKS5: <code>socks5://${escapeHtml(s.login)}:${escapeHtml(s.password)}@${escapeHtml(host)}:${s.node.socksPort}</code>\n`;
    text += `• HTTP: <code>http://${escapeHtml(s.login)}:${escapeHtml(s.password)}@${escapeHtml(host)}:${s.node.httpPort}</code>\n\n`;
  }
  text += "Скопируйте строку в настройки прокси вашего приложения.";

  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

/**
 * Отправить уведомление о создании Sing-box слотов (после оплаты).
 */
export async function notifySingboxSlotsCreated(clientId: string, slotIds: string[], tariffName?: string): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true, id: true } });
  if (!client?.telegramId || slotIds.length === 0) return;

  const slots = await prisma.singboxSlot.findMany({
    where: { id: { in: slotIds } },
    select: {
      userIdentifier: true,
      secret: true,
      node: { select: { publicHost: true, port: true, protocol: true, tlsEnabled: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const { buildSingboxSlotSubscriptionLink } = await import("../singbox/singbox-link.js");
  const name = tariffName?.trim() || "Sing-box";
  let text = `✅ <b>Доступы «${escapeHtml(name)}»</b> оплачены.\n\n`;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    const link = buildSingboxSlotSubscriptionLink(
      { publicHost: s.node.publicHost ?? "", port: s.node.port ?? 443, protocol: s.node.protocol ?? "VLESS", tlsEnabled: s.node.tlsEnabled },
      { userIdentifier: s.userIdentifier, secret: s.secret },
      `${name}-${i + 1}`
    );
    text += `• <code>${escapeHtml(link)}</code>\n\n`;
  }
  text += "Скопируйте ссылку в приложение (v2rayN, Nekoray, Shadowrocket и др.).";

  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

export async function notifyAutoRenewSuccess(clientId: string, tariffName: string, amount: number, currency: string): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true, id: true } });
  if (!client?.telegramId) return;
  const text = `🔄 <b>Автопродление успешно</b>\n\nТариф «${escapeHtml(tariffName)}» был автоматически продлен. Списано: ${formatMoney(amount, currency)}.`;
  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

export async function notifyAutoRenewFailed(clientId: string, tariffName: string, reason: "balance" | "error"): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true, id: true } });
  if (!client?.telegramId) return;
  let text = `❌ <b>Автопродление отключено</b>\n\nНе удалось автоматически продлить тариф «${escapeHtml(tariffName)}».\n`;
  if (reason === "balance") {
    text += "\nПричина: недостаточно средств на балансе. Все попытки исчерпаны.\n\n";
    text += "💡 <i>Пополните баланс и включите автопродление снова в кабинете или боте.</i>";
  } else {
    text += "\nПричина: системная ошибка. Все попытки исчерпаны.\n\n";
    text += "💡 <i>Обратитесь в поддержку или попробуйте продлить тариф вручную.</i>";
  }
  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

/**
 * Уведомление об успешном автоплатеже через ЮKassa.
 */
export async function notifyAutoRenewYookassaSuccess(
  clientId: string,
  tariffName: string,
  amount: number,
  currency: string,
  paymentMethodTitle?: string,
  balancePortion?: number,
  cardPortion?: number,
): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true, id: true } });
  if (!client?.telegramId) return;

  let text =
    `🔄 <b>Автопродление успешно (ЮKassa)</b>\n\n` +
    `Тариф «${escapeHtml(tariffName)}» был автоматически продлен.\n`;

  if (balancePortion && balancePortion > 0 && cardPortion) {
    text += `Списано с баланса: ${formatMoney(balancePortion, currency)}\n`;
    text += `Списано с карты: ${formatMoney(cardPortion, currency)}`;
  } else {
    text += `Списано с карты: ${formatMoney(amount, currency)}`;
  }

  if (paymentMethodTitle) {
    text += ` (${escapeHtml(paymentMethodTitle)})`;
  }
  text += `.`;

  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

/**
 * Уведомление о неудачном автоплатеже через ЮKassa.
 */
export async function notifyAutoRenewYookassaFailed(
  clientId: string,
  tariffName: string,
  error: string,
): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true, id: true } });
  if (!client?.telegramId) return;

  const text =
    `❌ <b>Автоплатёж ЮKassa не прошёл</b>\n\n` +
    `Не удалось списать оплату за тариф «${escapeHtml(tariffName)}».\n` +
    `Причина: ${escapeHtml(error)}\n\n` +
    `💡 <i>Попробуйте пополнить баланс или оплатить тариф вручную.</i>`;

  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

/**
 * Уведомление о приближающемся списании (low balance warning).
 * Отправляется за N дней до истечения, если баланс меньше стоимости тарифа.
 */
export async function notifyAutoRenewUpcoming(
  clientId: string,
  tariffName: string,
  price: number,
  currency: string,
  daysLeft: number,
): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true, balance: true, id: true },
  });
  if (!client?.telegramId) return;

  const deficit = price - (client.balance ?? 0);
  const text =
    `⏳ <b>Скоро автопродление</b>\n\n` +
    `Тариф «${escapeHtml(tariffName)}» истекает через <b>${daysLeft} дн.</b>\n` +
    `Стоимость продления: ${formatMoney(price, currency)}\n` +
    `Ваш баланс: ${formatMoney(client.balance ?? 0, currency)}\n\n` +
    `⚠️ Не хватает <b>${formatMoney(Math.max(0, deficit), currency)}</b> для автопродления.\n` +
    `💡 <i>Пополните баланс, чтобы подписка продлилась автоматически.</i>`;

  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

/**
 * Уведомление о повторной попытке списания (retry attempt).
 */
export async function notifyAutoRenewRetry(
  clientId: string,
  tariffName: string,
  price: number,
  currency: string,
  currentRetry: number,
  maxRetries: number,
): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true, balance: true, id: true },
  });
  if (!client?.telegramId) return;

  const retriesLeft = maxRetries - currentRetry;
  const text =
    `🔄 <b>Не удалось продлить подписку</b>\n\n` +
    `Тариф «${escapeHtml(tariffName)}»: недостаточно средств.\n` +
    `Нужно: ${formatMoney(price, currency)} | Баланс: ${formatMoney(client.balance ?? 0, currency)}\n\n` +
    `Попытка ${currentRetry} из ${maxRetries}` +
    (retriesLeft > 0 ? `. Осталось попыток: <b>${retriesLeft}</b>.` : `. Это была последняя попытка.`) +
    `\n\n💡 <i>Пополните баланс, чтобы автопродление сработало при следующей проверке.</i>`;

  const cfg = await getSystemConfig();
  await sendTelegramToUser(client.telegramId, text, null, backToMenuMarkup(cfg.botBackLabel), { clientIdForBotToken: client.id });
}

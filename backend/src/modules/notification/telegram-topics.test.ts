import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const {
  MAIN_TELEGRAM_NOTIFICATION_TOPICS,
  MANAGERS_TELEGRAM_NOTIFICATION_TOPIC,
  ensureTelegramNotificationTopics,
  getTelegramTopicResetKeys,
} = await import("./telegram-topics.js");
const { getTopicIdForEvent } = await import("./telegram-notify.service.js");

test("defines all main and managers topic names", () => {
  assert.deepEqual(MAIN_TELEGRAM_NOTIFICATION_TOPICS.map((topic) => topic.name), [
    "👤 Новые клиенты",
    "💳 Платежи",
    "🎫 Тикеты",
    "💾 Авто-бэкапы",
    "🎁 Пробный период",
    "🔄 Конвертации",
    "💸 Заявки на вывод",
    "🏷 Промокоды",
    "🎟 Подарки",
    "⚠️ Сбои автосписания",
    "⛔ Аннулирование подписок",
  ]);
  assert.equal(MANAGERS_TELEGRAM_NOTIFICATION_TOPIC.name, "🎫 Тикеты менеджеров");
});

test("creates only missing topics and stores returned IDs", async () => {
  const calls: Array<{ chatId: string; name: string }> = [];
  const saved: Record<string, string> = {};

  await ensureTelegramNotificationTopics({
    botToken: "token",
    groupId: "-1001",
    managersGroupId: "",
    topicIds: { notification_topic_payments: "42" },
    setTopicId: async (key, id) => {
      saved[key] = id;
    },
    request: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { chat_id: string; name: string };
      calls.push({ chatId: body.chat_id, name: body.name });
      return Response.json({ ok: true, result: { message_thread_id: 100 + calls.length } });
    },
  });

  assert.equal(calls.length, 10);
  assert.equal(saved.notification_topic_payments, undefined);
  assert.equal(saved.notification_topic_new_clients, "101");
});

test("propagates Telegram topic creation errors", async () => {
  await assert.rejects(
    ensureTelegramNotificationTopics({
      botToken: "token",
      groupId: "-1001",
      managersGroupId: "",
      topicIds: {},
      setTopicId: async () => undefined,
      request: async () => Response.json({ ok: false, description: "Bad Request: not a forum" }),
    }),
    /not a forum/,
  );
});

test("resets main or managers IDs only for the group that changed", () => {
  assert.deepEqual(
    getTelegramTopicResetKeys(true, false),
    MAIN_TELEGRAM_NOTIFICATION_TOPICS.map((topic) => topic.settingKey),
  );
  assert.deepEqual(getTelegramTopicResetKeys(false, true), ["notification_managers_topic_tickets"]);
});

test("maps revoked subscription notifications to their dedicated setting", () => {
  assert.equal(getTopicIdForEvent({ notificationTopicSubscriptionRevoked: "77" }, "subscription_revoked"), 77);
});

import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { notifyTrafficMilestones } = await import("./traffic-notification.service.js");

function memoryNotifier(options: { telegramId?: string | null; failSend?: boolean } = {}) {
  const quota = {
    id: "quota-1", subscriptionId: "sub-1", usedBytes: 75n, baseLimitBytes: 100n,
    notifiedPercents: [] as number[], periodEndsAt: new Date("2026-08-01T00:00:00.000Z"),
    subscription: { owner: { id: "client-1", telegramId: options.telegramId === undefined ? "12345" : options.telegramId } },
  };
  const events: Array<Record<string, unknown>> = [];
  const messages: Array<{ telegramId: string; text: string; replyMarkup?: Record<string, unknown> }> = [];
  const dependencies = {
    prisma: {
      squadTrafficQuota: {
        findUnique: async () => quota,
        updateMany: async ({ where, data }: { where: { id: string; NOT: { notifiedPercents: { has: number } } }; data: { notifiedPercents: { push: number } } }) => {
          const percent = where.NOT.notifiedPercents.has;
          if (where.id !== quota.id || quota.notifiedPercents.includes(percent) || data.notifiedPercents.push !== percent) return { count: 0 };
          quota.notifiedPercents.push(percent);
          return { count: 1 };
        },
      },
      trafficQuotaEvent: { create: async ({ data }: { data: Record<string, unknown> }) => events.push(data) },
    },
    sendTelegramToUser: async (telegramId: string, text: string, _threadId?: number | null, replyMarkup?: Record<string, unknown>) => {
      messages.push({ telegramId, text, replyMarkup });
      if (options.failSend) throw new Error("telegram unavailable");
    },
  };
  return { dependencies, quota, events, messages };
}

test("milestones reserve then send in 50/25/10/3/0 order exactly once across restart", async () => {
  const { dependencies, quota, messages } = memoryNotifier();
  await notifyTrafficMilestones("sub-1", [0, 3, 10, 25, 50], dependencies);
  await notifyTrafficMilestones("sub-1", [50, 25, 10, 3, 0], dependencies);

  assert.deepEqual(quota.notifiedPercents, [50, 25, 10, 3, 0]);
  assert.equal(messages.length, 5);
  assert.match(messages[0]?.text ?? "", /^📶 Осталось 50% трафика/);
  assert.match(messages[0]?.text ?? "", /Использовано: 75 Б из 100 Б/);
  assert.doesNotMatch(messages[0]?.text ?? "", /байт/i);
  assert.equal((messages[0]?.replyMarkup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> })?.inline_keyboard?.[0]?.[0]?.callback_data, "menu:extra_options");
  assert.match(messages[4]?.text ?? "", /^⛔ Трафик закончился/);
  assert.match(messages[4]?.text ?? "", /Продлите тариф или добавьте трафик/);
});

test("missing Telegram recipient records a skip event after reservation", async () => {
  const { dependencies, quota, events, messages } = memoryNotifier({ telegramId: null });
  await notifyTrafficMilestones("sub-1", [25], dependencies);

  assert.deepEqual(quota.notifiedPercents, [25]);
  assert.equal(messages.length, 0);
  assert.equal(events[0]?.kind, "NOTIFICATION_SKIPPED_NO_TELEGRAM");
});

test("send failure records an event and does not release the reserved threshold", async () => {
  const { dependencies, quota, events, messages } = memoryNotifier({ failSend: true });
  await notifyTrafficMilestones("sub-1", [0], dependencies);
  await notifyTrafficMilestones("sub-1", [0], dependencies);

  assert.deepEqual(quota.notifiedPercents, [0]);
  assert.equal(messages.length, 1);
  assert.equal(events[0]?.kind, "NOTIFICATION_FAILED");
  assert.match(JSON.stringify(events[0]?.detail), /telegram unavailable/);
});

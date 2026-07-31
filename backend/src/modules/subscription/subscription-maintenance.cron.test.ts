import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { expiryReminderOffset, expiringSubscriptionKind, parseReminderHours } = await import("./subscription-maintenance.cron.js");
const { SUBSCRIPTION_UPDATE_TEXT, renderExpiryReminderText, subscriptionExpiryMarkup } = await import("../notification/telegram-notify.service.js");

test("trial reminders are scheduled at 3 hours and 30 minutes", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");
  assert.equal(expiryReminderOffset(new Date("2026-07-27T15:00:00.000Z"), now), 180);
  assert.equal(expiryReminderOffset(new Date("2026-07-27T12:30:00.000Z"), now), 30);
  assert.equal(expiryReminderOffset(new Date("2026-07-27T14:00:00.000Z"), now), null);
  assert.deepEqual(parseReminderHours("72, 24, 3, 0.5"), [4320, 1440, 180, 30]);
});

test("trial chooses a tariff while paid subscription renews itself", () => {
  assert.equal(expiringSubscriptionKind({ trialId: "trial", tariffId: null, owner: { trialUsed: true } }), "trial");
  assert.equal(expiringSubscriptionKind({ trialId: null, tariffId: "tariff", owner: { trialUsed: true } }), "paid");
  assert.deepEqual(subscriptionExpiryMarkup("💳 Продлить подписку", "pay_tariff_ext:sub-1"), {
    inline_keyboard: [
      [{ text: "💳 Продлить подписку", callback_data: "pay_tariff_ext:sub-1" }],
      [{ text: "◀️ В меню", callback_data: "menu:main" }],
    ],
  });
  assert.match(renderExpiryReminderText("Тариф {{name}}, осталось {{time}}", "<VPN>", 90), /&lt;VPN&gt;.*1\.5 ч\./);
  assert.match(SUBSCRIPTION_UPDATE_TEXT, /HAPP.*INCY.*↻/);
});

test("payment notification guide images are packaged", async () => {
  for (const name of ["happ-how-to-update.png", "incy-how-to-update.png"]) {
    assert.ok((await stat(new URL(`../../assets/guides/${name}`, import.meta.url))).size > 0);
  }
});

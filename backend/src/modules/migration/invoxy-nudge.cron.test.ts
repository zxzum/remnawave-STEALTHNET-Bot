import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { daysLeft, nudgeTelegramText, nudgeEmailHtml } = await import("./invoxy-nudge.cron.js");

test("days left rounds up and never goes negative", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  assert.equal(daysLeft(new Date("2026-11-16T13:00:00Z"), now), 1);
  assert.equal(daysLeft(new Date("2026-11-26T12:00:00Z"), now), 10);
  assert.equal(daysLeft(new Date("2026-11-15T12:00:00Z"), now), 0);
});

test("nudge texts use the right Russian plural and the +5 days bonus", () => {
  assert.match(nudgeTelegramText(1), /Осталось 1 день\./);
  assert.match(nudgeTelegramText(3), /Осталось 3 дня\./);
  assert.match(nudgeTelegramText(11), /Осталось 11 дней\./);
  assert.match(nudgeTelegramText(22), /Осталось 22 дня\./);
  assert.match(nudgeTelegramText(5), /5 дней в подарок/);
  assert.match(nudgeEmailHtml(7), /осталось 7 дней/);
  assert.match(nudgeEmailHtml(7), /Привязать Telegram/);
});

import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { buildTariffAdminNotificationText, formatPartnerNotificationLine } = await import("./telegram-notify.service.js");

test("admin grant notification is not presented as a payment", () => {
  const text = buildTariffAdminNotificationText({
    isAdminGrant: true,
    clientLabel: "@client",
    telegramId: "123",
    tariffName: "Standard",
    durationDays: 30,
    amount: 0,
    currency: "RUB",
    provider: "admin_grant",
    date: new Date("2026-08-04T10:20:30Z"),
  });

  assert.match(text, /Администратор выдал подписку/);
  assert.doesNotMatch(text, /Оплата тарифа|Сумма:|Провайдер:/);
});

test("paid tariff notification still contains payment details", () => {
  const text = buildTariffAdminNotificationText({
    isAdminGrant: false,
    clientLabel: "@client",
    tariffName: "Standard",
    durationDays: 30,
    amount: 499,
    currency: "RUB",
    provider: "platega",
    date: new Date("2026-08-04T10:20:30Z"),
  });

  assert.match(text, /Оплата тарифа/);
  assert.match(text, /499\.00 ₽/);
  assert.match(text, /platega/);
});

test("new client notification identifies the referring partner", () => {
  assert.equal(
    formatPartnerNotificationLine({ telegramUsername: "partner", telegramId: "456" }),
    "🤝 Партнёр: @partner (TG ID: 456)",
  );
});

import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { deliverSupportReplyToClient } = await import("./telegram-notify.service.js");
const { TEMPLATES, renderTemplate } = await import("../email-templates/email-templates.service.js");

test("delivers a support reply to both Telegram and email", async () => {
  const telegram: Array<{ id: string; text: string }> = [];
  const emails: Array<{ to: string; subject: string; body: string }> = [];

  const attempted = await deliverSupportReplyToClient({
    client: { id: "client-1", telegramId: "123456", email: "user@example.com" },
    ticket: { id: "ticket-1", subject: "Не подключается" },
    content: "Проверьте подключение ещё раз",
    attachmentsCount: 0,
    config: {
      publicAppUrl: "https://vpn.example",
      serviceName: "Лазейка ВПН",
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpFromEmail: "support@example.com",
    },
  }, {
    sendTelegram: async (id: string, text: string) => { telegram.push({ id, text }); },
    renderEmail: async (key: string, vars: Record<string, string>) => {
      const template = TEMPLATES.find((item) => item.key === key);
      return template ? {
        subject: renderTemplate(template.defaultSubject, vars),
        body: renderTemplate(template.defaultBody, vars),
      } : null;
    },
    sendMail: async (_config: unknown, to: string, subject: string, body: string) => {
      emails.push({ to, subject, body });
      return { ok: true };
    },
  });

  assert.deepEqual(attempted, { telegram: true, email: true });
  assert.deepEqual(telegram, [{
    id: "123456",
    text: "💬 <b>Новый ответ в тикете</b>\n\n📋 Не подключается\n\nПроверьте подключение ещё раз",
  }]);
  assert.equal(emails[0]?.to, "user@example.com");
  assert.equal(emails[0]?.subject, "Новый ответ в тикете — Лазейка ВПН");
  assert.match(emails[0]!.body, /Проверьте подключение ещё раз/);
  assert.match(emails[0]!.body, /https:\/\/vpn\.example\/cabinet\/tickets/);
});

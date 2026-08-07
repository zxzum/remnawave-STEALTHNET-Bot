import assert from "node:assert/strict";
import test from "node:test";

import { formatBotErrorNotification } from "./telegram-error-notification.js";

test("formats Telegram API errors with time and safe user context", () => {
  const text = formatBotErrorNotification({
    occurredAt: "2026-08-07T12:34:56.000Z",
    method: "sendPhoto",
    errorName: "GrammyError",
    message: "Call to 'sendPhoto' failed! (400: Bad Request: failed to get HTTP URL content) <bad>",
    stack: "Error: failed\n at handler (bot.ts:1:2)",
    telegram: { userId: 123, username: "alex", firstName: "Алекс", chatId: 123, updateId: 77, messageId: 88 },
  }, { id: "client-1", email: "alex@example.com", telegramId: "123", telegramUsername: "alex" });

  assert.match(text, /sendPhoto/);
  assert.match(text, /2026-08-07T12:34:56\.000Z/);
  assert.match(text, /client-1/);
  assert.match(text, /@alex/);
  assert.match(text, /failed to get HTTP URL content/);
  assert.match(text, /&lt;bad&gt;/); // HTML escaping is applied to untrusted error text.
  assert.ok(text.length < 4096);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("./client.routes.ts", import.meta.url), "utf8");

test("Mini App linking sends a cabinet Web App button", () => {
  assert.match(routes, /sendTelegramToUser/);
  assert.match(routes, /web_app/);
  assert.match(routes, /\/cabinet/);
  assert.match(routes, /notifyTelegramLinkSuccess/);
});

test("unlink route preserves access and clears Telegram state", () => {
  const start = routes.indexOf('clientRouter.post("/unlink-telegram"');
  assert.ok(start >= 0);
  const end = routes.indexOf("\n/**", start);
  const block = routes.slice(start, end > start ? end : undefined);
  assert.match(block, /isBotOnlyAccount/);
  assert.match(block, /telegramId:\s*null/);
  assert.match(block, /telegramUsername:\s*null/);
  assert.match(block, /telegramUnreachable:\s*false/);
  assert.match(block, /pendingTelegramLink\.deleteMany/);
});

test("bot deep-link remains responsible for its own success message", () => {
  const start = routes.indexOf('publicConfigRouter.post("/link-telegram-from-bot"');
  assert.ok(start >= 0);
  const block = routes.slice(start);
  assert.match(block, /Telegram привязан/);
});

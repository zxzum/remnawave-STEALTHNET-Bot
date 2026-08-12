import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const clientLayout = readFileSync(resolve(root, "frontend/src/cabinet/components/Layout.tsx"), "utf8");
const profile = readFileSync(resolve(root, "frontend/src/cabinet/pages/Profile.tsx"), "utf8");
const floatingChat = readFileSync(resolve(root, "frontend/src/components/floating-chat.tsx"), "utf8");
test("profile contains a top referral block and Telegram support button", () => {
  assert.match(profile, /<ReferralPromo \/>/);
  assert.match(profile, /<SupportButton \/>/);
  assert.match(profile, /config\?\.supportLink\?\.trim\(\) \|\| \"https:\/\/t\.me\/lazeika_support_bot\"/);
  assert.doesNotMatch(profile, /telegramBotUsername\?\.replace/);
});

test("floating chat exposes Telegram support in both modes and clears mobile navigation", () => {
  assert.match(floatingChat, /function TelegramSupportCta/);
  assert.match(floatingChat, /Написать в Telegram/);
  assert.match(floatingChat, /config\?\.supportLink\?\.trim\(\)/);
  assert.match(floatingChat, /<TelegramSupportCta href=\{supportUrl\} \/>/);
  assert.match(floatingChat, /min-h-8/);
  assert.match(floatingChat, /mx-4 mt-2 mb-1/);
  assert.match(floatingChat, /h-6 w-6/);
  assert.match(floatingChat, /rounded-lg/);
  assert.doesNotMatch(floatingChat, /Поддержка Лазейки ВПН/);
  assert.match(floatingChat, /from-violet-900\/80/);
  assert.match(floatingChat, /bg-gradient-to-b from-violet-900\/12/);
  assert.ok((floatingChat.match(/<ChatHeader/g) ?? []).length >= 3);
  assert.match(floatingChat, /fixed bottom-32 right-4 z-\[100\] lg:bottom-6 lg:right-6/);
  assert.match(floatingChat, /motion-safe:animate-ping/);
  assert.match(floatingChat, /aria-label=\{isOpen \? "Закрыть чат" : "Открыть чат"\}/);
});

test("the active client cabinet bottom navigation has four core items", () => {
  assert.doesNotMatch(clientLayout, /label: "Рефералы"/);
  assert.match(clientLayout, /const items = \[\.\.\.navItems, \{ to: "\/cabinet\/profile"/);
  assert.match(clientLayout, /grid grid-cols-4/);
  assert.match(clientLayout, /w-1\/4/);
  assert.match(clientLayout, /text-xs font-semibold/);
  assert.match(clientLayout, /h-6 w-6/);
  assert.match(clientLayout, /bg-ink-950\/80/);
  assert.match(clientLayout, /border-violet-glow\/50/);
  assert.match(clientLayout, /from-accent-500\/30/);
  assert.match(clientLayout, /border-accent-400\/60/);
  assert.match(clientLayout, /isActive \? "text-accent-400 drop-shadow-/);
});

test("profile keeps purchase cards before promos on mobile and pins desktop columns", () => {
  assert.match(profile, /window\.innerWidth >= 1024/);
  assert.match(profile, /<div className="grid grid-cols-2 items-start gap-5">/);
  const bankCardIndex = profile.lastIndexOf("<BankCard />");
  const topUpIndex = profile.lastIndexOf("<TopUp />");
  const referralIndex = profile.lastIndexOf("<ReferralPromo />");
  const supportIndex = profile.lastIndexOf("<SupportButton />");
  const accountDataIndex = profile.lastIndexOf("<AccountData />");
  assert.ok(bankCardIndex < topUpIndex && topUpIndex < referralIndex && referralIndex < supportIndex && supportIndex < accountDataIndex);
  assert.match(profile, /className="mx-auto w-full max-w-md"/);
  assert.doesNotMatch(profile, /lg:h-full lg:min-h-32/);
});

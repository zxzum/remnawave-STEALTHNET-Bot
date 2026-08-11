import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const layout = readFileSync(resolve(root, "frontend/src/pages/cabinet/cabinet-layout.tsx"), "utf8");
const clientLayout = readFileSync(resolve(root, "frontend/src/cabinet/components/Layout.tsx"), "utf8");
const profile = readFileSync(resolve(root, "frontend/src/cabinet/pages/Profile.tsx"), "utf8");
const navSource = layout.match(/function useNavItems\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
const mobileSource = layout.match(/function MobileCabinetShell\(\) \{([\s\S]*?)\n\}\n\nfunction useIsMobile/)?.[1] ?? "";

test("mobile navigation prioritizes four core cabinet routes", () => {
  const routes = [...navSource.matchAll(/to: "(\/cabinet\/[^\"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(routes.slice(0, 4), [
    "/cabinet/dashboard",
    "/cabinet/singbox",
    "/cabinet/tariffs",
    "/cabinet/profile",
  ]);
  assert.match(layout, /const MAX_VISIBLE_NAV = 4/);
  assert.doesNotMatch(mobileSource, /hasMore/);
  assert.doesNotMatch(mobileSource, /cabinet\.nav\.more/);
  assert.match(mobileSource, /h-\[5rem\]/);
  assert.match(mobileSource, /text-xs font-semibold/);
});

test("profile contains a top referral block and Telegram support button", () => {
  assert.match(profile, /<ReferralPromo \/>/);
  assert.match(profile, /<SupportButton \/>/);
  assert.match(profile, /config\?\.telegramBotUsername\?\.replace\(\/\^@\/\, \"\"\)/);
  assert.match(profile, /https:\/\/t\.me\/\$\{botUsername\}/);
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

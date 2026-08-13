# Mini-app-first Bot Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the existing first-run trial onboarding while replacing the returning-user bot menu with a flat Mini App navigation menu and an existing-flow renewal payment chooser.

**Architecture:** Keep onboarding and payment handlers intact. Make `mainMenu` a fixed, explicit keyboard; move the returning-user caption formatter into one pure, tested module; then wire current subscription/tariff data into both from `/start`. Renewal reuses the existing `pay_tariff:<tariffId>:r` path, so provider creation, webhook fulfillment, and Telegram notifications remain unchanged.

**Tech Stack:** TypeScript 5.6, Node.js 22, grammY, built-in `node:test`, existing backend client API.

## Global Constraints

- Work only on branch `codex/miniapp-first-bot-menu`; the pre-change bot is preserved at `codex/backup-bot-menu-before-redesign`.
- The user-facing product name is **Лазейка ВПН**; legacy `stealthnet` technical identifiers remain unchanged.
- Preserve the current welcome → trial → connection guide → connected status → main-menu onboarding flow.
- Remove ordinary user submenus from the main keyboard; renewal's required duration/payment choices remain.
- `ВОЙТИ В КАБИНЕТ` is green; all other main-menu buttons are blue.
- Do not add dependencies, database tables, queues, payment endpoints, or duplicate Mini App pages.
- Do not modify unrelated dirty-worktree files.

## File Map

- Modify `bot/src/keyboard.ts`: fixed main-menu keyboard, direct Web App/support URLs, renewal callback, admin visibility.
- Modify `bot/src/keyboard.test.ts`: exact layout, URL, callback, color, support, and admin assertions.
- Create `bot/src/main-menu-summary.ts`: pure formatter for the returning-user caption and primary-subscription selection.
- Create `bot/src/main-menu-summary.test.ts`: active/expired/missing subscription and quota/traffic/tariff-price checks.
- Modify `bot/src/index.ts`: fetch tariff catalog with existing requests, invoke the formatter, pass menu destinations, add the Info stub, and leave onboarding/payment handlers intact.
- Modify `bot/src/welcome-photo.test.ts`: source-level regression assertions that onboarding remains before the returning-user menu and renewal routes into the existing payment flow.

---

### Task 1: Fixed Main Menu Keyboard

**Files:**
- Modify: `bot/src/keyboard.ts:7-304`
- Test: `bot/src/keyboard.test.ts:1-130`

**Interfaces:**
- Consumes: `MenuOptions.appUrl`, `MenuOptions.supportUrl`, `MenuOptions.renewTariffId`, `MenuOptions.isAdmin`.
- Produces: `mainMenu(opts: MenuOptions): InlineMarkup` with fixed rows and no ordinary submenu callbacks.

- [ ] **Step 1: Replace the old main-menu assertions with failing layout and routing assertions**

Keep legacy section-menu tests only if their helpers remain used by onboarding/admin flows. Add this exact main-menu expectation:

```ts
function buildMain(overrides: Partial<Parameters<typeof mainMenu>[0]> = {}) {
  return mainMenu({
    showTrial: false,
    showVpn: true,
    appUrl: "https://bot.lazeika.xyz",
    supportUrl: "https://t.me/lazeyka_support_bot",
    renewTariffId: "tariff-standard",
    isAdmin: false,
    ...overrides,
  });
}

test("главное меню плоское и ведёт прямо в mini-app", () => {
  const markup = buildMain();
  assert.deepEqual(labels(markup), [
    ["👤 ВОЙТИ В КАБИНЕТ"],
    ["💳 Тарифы", "🔑 Мои ключи"],
    ["🤝 Рефералка", "🛠 Поддержка"],
    ["🔄 Продлить", "ℹ️ Инфо"],
  ]);
  assert.deepEqual(markup.inline_keyboard.map((row) => row.map((button) =>
    "web_app" in button ? button.web_app.url : "url" in button ? button.url : button.callback_data
  )), [
    ["https://bot.lazeika.xyz/cabinet"],
    ["https://bot.lazeika.xyz/cabinet/tariffs", "https://bot.lazeika.xyz/cabinet/subscribe"],
    ["https://bot.lazeika.xyz/cabinet/referral", "https://t.me/lazeyka_support_bot"],
    ["pay_tariff:tariff-standard:r", "menu:info"],
  ]);
});

test("цвета, отсутствие тарифа, support и admin обрабатываются явно", () => {
  assert.deepEqual(
    buildMain({ isAdmin: true }).inline_keyboard.map((row) => row.map((button) => "style" in button ? button.style : undefined)),
    [["success"], ["primary", "primary"], ["primary", "primary"], ["primary", "primary"], ["primary"]],
  );
  assert.equal(callbacks(buildMain({ renewTariffId: null }))[3]![0], "menu:renew");
  assert.equal(labels(buildMain({ supportUrl: null }))[2]!.includes("🛠 Поддержка"), false);
  assert.deepEqual(labels(buildMain({ isAdmin: true })).at(-1), ["⚙️ Админ-панель"]);
});
```

- [ ] **Step 2: Run the keyboard test and verify the new expectations fail**

Run: `cd bot && npm test -- --test-name-pattern='главное меню'`

Expected: FAIL because `supportUrl`, `renewTariffId`, `isAdmin`, the direct routes, and fixed layout are not implemented.

- [ ] **Step 3: Implement the smallest explicit keyboard**

Extend `MenuOptions`:

```ts
supportUrl?: string | null;
renewTariffId?: string | null;
isAdmin?: boolean;
```

Build `mainMenu` directly rather than routing it through configurable legacy button lists:

```ts
export function mainMenu(opts: MenuOptions): InlineMarkup {
  const base = opts.appUrl?.trim().replace(/\/$/, "") ?? "";
  const web = (text: string, path: string, style: ButtonStyle = "primary"): WebAppButton => ({
    text, web_app: { url: `${base}${path}` }, style,
  });
  const rows: InlineMarkup["inline_keyboard"] = [];
  if (base) {
    rows.push([web("👤 ВОЙТИ В КАБИНЕТ", "/cabinet", "success")]);
    rows.push([web("💳 Тарифы", "/cabinet/tariffs"), web("🔑 Мои ключи", "/cabinet/subscribe")]);
    rows.push([
      web("🤝 Рефералка", "/cabinet/referral"),
      ...(opts.supportUrl ? [{ text: "🛠 Поддержка", url: opts.supportUrl, style: "primary" as const }] : []),
    ]);
  }
  rows.push([
    btn("🔄 Продлить", opts.renewTariffId ? `pay_tariff:${opts.renewTariffId}:r` : "menu:renew", "primary"),
    btn("ℹ️ Инфо", "menu:info", "primary"),
  ]);
  if (opts.isAdmin) rows.push([btn("⚙️ Админ-панель", "admin:menu", "primary")]);
  return { inline_keyboard: rows.filter((row) => row.length > 0) };
}
```

Keep legacy section helpers only where referenced outside `mainMenu`; do not delete unrelated callbacks in this task.

- [ ] **Step 4: Run keyboard tests**

Run: `cd bot && npm test -- --test-name-pattern='главное меню'`

Expected: PASS.

- [ ] **Step 5: Commit the keyboard unit**

```bash
git add bot/src/keyboard.ts bot/src/keyboard.test.ts
git commit -m "feat(bot): flatten main menu navigation"
```

---

### Task 2: Pure Main Menu Summary

**Files:**
- Create: `bot/src/main-menu-summary.ts`
- Create: `bot/src/main-menu-summary.test.ts`
- Modify: `bot/src/index.ts:1489-1543` (remove superseded compact formatter after wiring in Task 3)

**Interfaces:**
- Produces: `selectPrimarySubscription(items: MainMenuSubscription[]): MainMenuSubscription | null`.
- Produces: `buildMainMenuSummary(input: MainMenuSummaryInput): string`.
- `MainMenuSummaryInput` contains `subscription`, optional matched `tariff`, and no bot/network dependencies.

- [ ] **Step 1: Write failing formatter tests**

Create representative tests without mocks:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildMainMenuSummary, selectPrimarySubscription } from "./main-menu-summary.js";

const active = {
  type: "root" as const,
  id: "client-1",
  subscriptionIndex: 0,
  tariffId: "standard",
  tariffDisplayName: "Стандартный",
  subscription: {
    status: "ACTIVE",
    expireAt: "2026-09-13T10:00:00.000Z",
    userTraffic: { usedTrafficBytes: 67 * 1024 ** 3 },
    trafficLimitBytes: 0,
  },
  trafficQuota: {
    usedBytes: String(12 * 1024 ** 3),
    limitBytes: String(50 * 1024 ** 3),
    remainingBytes: String(38 * 1024 ** 3),
    status: "ACTIVE",
  },
};

test("активная подписка показывает тариф, белый и общий трафик", () => {
  const text = buildMainMenuSummary({
    subscription: active,
    tariff: { id: "standard", name: "Стандартный", price: 299, currency: "RUB", durationDays: 30, trafficLimitBytes: 50 * 1024 ** 3 },
    now: new Date("2026-08-13T00:00:00.000Z"),
  });
  assert.match(text, /👋 Добро пожаловать в Лазейка ВПН!/);
  assert.match(text, /🛡 Ваша подписка: 🟢 Активна/);
  assert.match(text, /☁️ Белый интернет: 12 ГБ из 50 ГБ/);
  assert.match(text, /📊 Общий трафик: 67 ГБ · безлимит/);
  assert.match(text, /📦 Ваш тариф: Стандартный · 299 ₽\/мес\./);
  assert.match(text, /🌐 Включено: 50 ГБ белого интернета/);
});

test("отсутствующая подписка не выдумывает дату и трафик", () => {
  assert.equal(buildMainMenuSummary({ subscription: null, tariff: null }), [
    "👋 Добро пожаловать в Лазейка ВПН!",
    "",
    "🛡 Ваша подписка: 🔴 Не активна",
    "📦 Ваш тариф: не выбран",
    "",
    "Выберите действие 👇",
  ].join("\n"));
});

test("primary выбирается раньше secondary", () => {
  assert.equal(selectPrimarySubscription([{ ...active, type: "secondary", id: "s1", subscriptionIndex: 1 }, active])?.id, "client-1");
});

test("истёкшая подписка и ограниченный общий трафик форматируются явно", () => {
  const text = buildMainMenuSummary({
    subscription: {
      ...active,
      subscription: {
        status: "EXPIRED",
        expireAt: "2026-08-01T00:00:00.000Z",
        userTraffic: { usedTrafficBytes: 20 * 1024 ** 3 },
        trafficLimitBytes: 100 * 1024 ** 3,
      },
      trafficQuota: null,
    },
    tariff: { id: "standard", name: "Стандартный", price: 299, currency: "RUB", durationDays: 30 },
  });
  assert.match(text, /🛡 Ваша подписка: 🔴 Истекла/);
  assert.match(text, /📊 Общий трафик: 20 ГБ из 100 ГБ/);
  assert.doesNotMatch(text, /Белый интернет/);
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `cd bot && npm test -- --test-name-pattern='подписка|трафик|primary'`

Expected: FAIL with module-not-found for `main-menu-summary.js`.

- [ ] **Step 3: Implement the formatter using only standard language APIs**

Implement these exact public shapes:

```ts
export type MainMenuSubscription = {
  type: "root" | "secondary";
  id: string;
  subscriptionIndex: number | null;
  tariffId: string | null;
  tariffDisplayName: string;
  subscription: unknown;
  trafficQuota?: { usedBytes: string; limitBytes: string } | null;
};

export type MainMenuTariff = {
  id: string;
  name: string;
  price: number;
  currency: string;
  durationDays: number;
  trafficLimitBytes?: number | null;
};

export function selectPrimarySubscription(items: MainMenuSubscription[]): MainMenuSubscription | null;
export function buildMainMenuSummary(input: {
  subscription: MainMenuSubscription | null;
  tariff: MainMenuTariff | null;
  now?: Date;
}): string;
```

Use `Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" })` for the date, a local `formatGb(bytes)` for compact decimal GB, and a small status map. Omit optional lines when their source value is absent or invalid. For the tariff price, use the current tariff base `price`; append `/мес.` when `durationDays === 30`, otherwise append `/ ${durationDays} дн.`.

- [ ] **Step 4: Run formatter tests**

Run: `cd bot && npm test -- --test-name-pattern='подписка|трафик|primary'`

Expected: PASS.

- [ ] **Step 5: Commit the formatter unit**

```bash
git add bot/src/main-menu-summary.ts bot/src/main-menu-summary.test.ts
git commit -m "feat(bot): format compact subscription summary"
```

---

### Task 3: Wire Returning Users, Renewal, Support, Info, and Admin

**Files:**
- Modify: `bot/src/index.ts:2380-2485`
- Modify: `bot/src/index.ts:3100-3130`
- Modify: `bot/src/index.ts:3990-4010`
- Test: `bot/src/welcome-photo.test.ts`

**Interfaces:**
- Consumes: `selectPrimarySubscription`, `buildMainMenuSummary`, and Task 1 `mainMenu` options.
- Reuses: existing `pay_tariff:<tariffId>:r` handler and all existing provider-specific payment handlers.
- Produces: `menu:info` and `menu:renew` fallback responses.

- [ ] **Step 1: Add failing source-contract regressions**

Extend `welcome-photo.test.ts` with narrow source checks:

```ts
test("returning-user menu keeps onboarding first and reuses renewal payment flow", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const welcome = source.indexOf("shouldShowBotWelcome({");
  const summary = source.indexOf("buildMainMenuSummary({");
  assert.ok(welcome >= 0 && summary > welcome);
  assert.match(source, /selectPrimarySubscription\(allSubsRes\.items/);
  assert.match(source, /supportUrl: supportBotLink\(\)/);
  assert.match(source, /renewTariffId: primarySubscription\?\.tariffId/);
  assert.match(source, /if \(data === "menu:info"\)/);
  assert.match(source, /if \(data === "menu:renew"\)/);
  assert.match(source, /data\.startsWith\("pay_tariff:"\)/);
});
```

- [ ] **Step 2: Run the contract test and verify failure**

Run: `cd bot && npm test -- --test-name-pattern='returning-user menu'`

Expected: FAIL because the new formatter and explicit menu options are not wired.

- [ ] **Step 3: Fetch tariffs with the existing `/api/public/tariffs` client and build the caption**

Add `api.getPublicTariffs()` to the existing `Promise.all`, flatten it once, and match the selected primary subscription:

```ts
const [subRes, proxyRes, singboxRes, allSubsRes, tariffRes] = await Promise.all([
  api.getSubscription(auth.token).catch(() => ({ subscription: null })),
  api.getPublicProxyTariffs().catch(() => ({ items: [] })),
  api.getPublicSingboxTariffs().catch(() => ({ items: [] })),
  api.getAllSubscriptions(auth.token).catch(() => ({ items: [] })),
  api.getPublicTariffs().catch(() => ({ items: [] })),
]);
const primarySubscription = selectPrimarySubscription(allSubsRes.items ?? []);
const currentTariff = tariffRes.items.flatMap((category) => category.tariffs)
  .find((tariff) => tariff.id === primarySubscription?.tariffId) ?? null;
const text = buildMainMenuSummary({ subscription: primarySubscription, tariff: currentTariff });
const entities: CustomEmojiEntity[] = [];
```

Delete the superseded `buildCompactMainMenuText`, `formatCompactSubscription`, and `subscriptionTrafficLines` only after confirming no remaining callers. Keep broadly used `richSubStats`/`gbCompact` helpers if other screens call them.

- [ ] **Step 4: Pass fixed destinations into `mainMenu` and remove post-build admin mutation**

Replace legacy main-menu-only options with:

```ts
const markup = mainMenu({
  showTrial,
  showVpn: Boolean(vpnUrl) || (allSubsRes.items?.length ?? 0) > 0,
  appUrl,
  supportUrl: supportBotLink(),
  renewTariffId: primarySubscription?.tariffId ?? null,
  isAdmin: config?.botAdminTelegramIds?.includes(String(from.id)) ?? false,
});
```

Do not delete config fields or submenu helpers used by onboarding/admin code elsewhere.

- [ ] **Step 5: Add Info and no-current-tariff fallback handlers**

Place these before generic legacy menu handling:

```ts
if (data === "menu:info") {
  await editMessageContent(ctx, "ℹ️ Раздел скоро появится.", {
    inline_keyboard: [[{ text: "🏠 Главное меню", callback_data: "menu:main" }]],
  });
  return;
}

if (data === "menu:renew") {
  const appUrl = config?.publicAppUrl?.replace(/\/$/, "");
  await editMessageContent(ctx, "У вас пока нет текущего тарифа для продления.", {
    inline_keyboard: [
      ...(appUrl ? [[{ text: "💳 Открыть тарифы", web_app: { url: `${appUrl}/cabinet/tariffs` } }]] : []),
      [{ text: "🏠 Главное меню", callback_data: "menu:main" }],
    ],
  });
  return;
}
```

The normal renewal button already emits `pay_tariff:<id>:r`; do not duplicate provider selection or payment creation.

- [ ] **Step 6: Run bot tests and TypeScript build**

Run: `cd bot && npm test && npm run build`

Expected: all tests PASS and `tsc` exits 0.

- [ ] **Step 7: Commit the integration unit**

```bash
git add bot/src/index.ts bot/src/welcome-photo.test.ts
git commit -m "feat(bot): connect main menu to mini app"
```

---

### Task 4: Final Regression and Scope Check

**Files:**
- Verify only; modify earlier files only if a check exposes a defect.

**Interfaces:**
- Verifies Tasks 1-3 together without changing payment/webhook contracts.

- [ ] **Step 1: Run the complete bot suite**

Run: `cd bot && npm test`

Expected: all tests PASS, including onboarding policy, keyboard, summary, subscription access, Telegram link, traffic, and welcome-photo contracts.

- [ ] **Step 2: Run the production compile**

Run: `cd bot && npm run build`

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 3: Check diff hygiene and changed-file scope**

Run: `git diff --check codex/backup-bot-menu-before-redesign...HEAD && git status --short`

Expected: no whitespace errors; implementation changes are limited to `bot/src/keyboard.ts`, `bot/src/keyboard.test.ts`, `bot/src/main-menu-summary.ts`, `bot/src/main-menu-summary.test.ts`, `bot/src/index.ts`, and `bot/src/welcome-photo.test.ts`, plus approved spec/plan documents. Pre-existing unrelated user changes remain untouched.

- [ ] **Step 4: Inspect the final branch commits**

Run: `git log --oneline codex/backup-bot-menu-before-redesign..HEAD`

Expected: design/plan commits followed by the focused keyboard, summary, and integration commits.

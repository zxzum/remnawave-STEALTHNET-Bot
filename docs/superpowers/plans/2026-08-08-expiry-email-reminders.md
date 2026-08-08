# Email-напоминания о продлении Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить независимые email-напоминания об окончании триала и обычной подписки с интервалом по умолчанию 24 часа, используя существующий Resend/SMTP транспорт и редактор шаблонов.

**Architecture:** Текущий пятиминутный cron будет выбирать подписки с Telegram или email, вычислять offset отдельно для каждого канала и хранить два новых дедупликационных ключа в `Subscription`. Новый notification-service будет рендерить `trial_expiring`/`subscription_expiring` через существующий `email-templates.service.ts` и отправлять через `mail.service.ts`; Resend выбирается уже имеющимся `mailProvider`.

**Tech Stack:** TypeScript, Node.js `node:test`, Prisma 6, PostgreSQL, Express/Zod, React/Vite, Resend API через существующий mail service.

## Global Constraints

- Продукт и пользовательские тексты называют продукт **Лазейка ВПН**; технические legacy-идентификаторы не переименовываются.
- Email-поля по умолчанию включены и используют ровно один интервал `"24"` часа для каждого типа напоминания.
- Почта отправляется только при наличии email, настроенного выбранного провайдера и `publicAppUrl`.
- Для Resend переиспользуются `mailConfigFromSystem`, `isMailConfigured`, `sendEmail`; новые зависимости и отдельный HTTP-клиент не добавляются.
- `Subscription.lastNotifiedKey` и существующая JSON-дедупликация авто-продления не изменяются.
- Новая логика реализуется через TDD: каждый новый поведенческий тест сначала запускается в RED-состоянии, затем покрывается минимальным кодом.
- Существующие незакоммиченные `.vscode/settings.json`, `AGENTS.md` и `docs/superpowers/plans/2026-08-07-public-whitelist-quota-api.md` не добавляются в коммиты этой задачи.

---

## File Map

### Create

- `backend/src/modules/notification/expiry-email-notify.service.ts` — форматирование переменных, выбор почтового шаблона и отправка через Resend/SMTP.
- `backend/src/modules/notification/expiry-email-notify.service.test.ts` — unit-тесты времени, переменных и выбора шаблона.
- `backend/prisma/migrations/20260808120000_add_expiry_reminder_keys/migration.sql` — две nullable-колонки дедупликации.
- `docs/superpowers/plans/2026-08-08-expiry-email-reminders.md` — этот план.

### Modify

- `backend/prisma/schema.prisma` — поля `expiryReminderKey` и `expiryEmailReminderKey` в `Subscription`.
- `backend/src/modules/client/client.service.ts` — четыре system keys и их значения по умолчанию.
- `backend/src/modules/admin/admin.routes.ts` — Zod-поля и сохранение четырёх настроек.
- `backend/src/modules/subscription/subscription-maintenance.cron.ts` — независимые Telegram/email offsets, выборка email и channel-specific дедупликация.
- `backend/src/modules/subscription/subscription-maintenance.cron.test.ts` — RED/GREEN-проверка channel-specific ключей и email offset.
- `backend/src/modules/email-templates/email-templates.service.ts` — новый `trial_expiring`, рабочий `subscription_expiring`, `timeLeft` и понятные дефолтные тексты.
- `frontend/src/lib/api.ts` — поля `UpdateSettingsInput` и `AdminSettings`.
- `frontend/src/pages/settings.tsx` — email switch + hours input внутри каждой карточки напоминания и payload сохранения.

## Interfaces

The implementation will expose these exact helpers from `expiry-email-notify.service.ts`:

```ts
export type ExpiryEmailKind = "trial" | "subscription";

export function expiryEmailTemplateKey(kind: ExpiryEmailKind): "trial_expiring" | "subscription_expiring";
export function formatExpiryEmailTime(minutesLeft: number): string;
export function buildExpiryEmailVariables(
  kind: ExpiryEmailKind,
  name: string,
  minutesLeft: number,
  config: { serviceName?: string | null; publicAppUrl?: string | null },
): Record<string, string>;
```

The cron will call this transport boundary:

```ts
export async function sendExpiryReminderEmail(
  config: Parameters<typeof mailConfigFromSystem>[0] & { serviceName?: string | null; publicAppUrl?: string | null },
  kind: ExpiryEmailKind,
  to: string,
  name: string,
  minutesLeft: number,
): Promise<boolean>;
```

The cron will use this deterministic key helper from `subscription-maintenance.cron.ts`:

```ts
export function expiryReminderKey(
  channel: "telegram" | "email",
  kind: "trial" | "paid",
  offset: number,
  expireAt: Date,
): string;
```

## Task 1: Write failing behavior tests

**Files:**

- Create: `backend/src/modules/notification/expiry-email-notify.service.test.ts`
- Modify: `backend/src/modules/subscription/subscription-maintenance.cron.test.ts`

**Interfaces:**

- Consumes: Existing `node:test`, `node:assert/strict`, `TEMPLATES`, `parseReminderHours`, and `expiryReminderOffset`.
- Produces: Failing executable expectations for the helpers defined above and the new email template contract.

- [x] **Step 1: Write the failing email helper tests**

Create the test with a safe dynamic import so the missing new module is reported as an assertion failure rather than an import crash:

```ts
import assert from "node:assert/strict";
import test from "node:test";

test("formats email reminder time in readable Russian units", async () => {
  let email: typeof import("./expiry-email-notify.service.js") | null = null;
  try { email = await import("./expiry-email-notify.service.js"); } catch { /* RED: module is not implemented yet */ }
  assert.equal(typeof email?.formatExpiryEmailTime, "function");
  if (!email) return;
  assert.equal(email.formatExpiryEmailTime(1440), "1 день");
  assert.equal(email.formatExpiryEmailTime(90), "1.5 часа");
  assert.equal(email.formatExpiryEmailTime(30), "30 минут");
});

test("builds escaped variables and cabinet URL for the selected email kind", async () => {
  let email: typeof import("./expiry-email-notify.service.js") | null = null;
  try { email = await import("./expiry-email-notify.service.js"); } catch { /* RED: module is not implemented yet */ }
  assert.equal(typeof email?.expiryEmailTemplateKey, "function");
  if (!email) return;
  assert.equal(email.expiryEmailTemplateKey("trial"), "trial_expiring");
  assert.equal(email.expiryEmailTemplateKey("subscription"), "subscription_expiring");
  assert.deepEqual(email.buildExpiryEmailVariables("trial", "<Триал>", 1440, {
    serviceName: "Лазейка ВПН",
    publicAppUrl: "https://vpn.example/",
  }), {
    serviceName: "Лазейка ВПН",
    trialName: "&lt;Триал&gt;",
    tariffName: "&lt;Триал&gt;",
    timeLeft: "1 день",
    daysLeft: "1",
    renewUrl: "https://vpn.example/cabinet",
  });
});

test("email template catalog contains wired trial and subscription expiry templates", async () => {
  const { TEMPLATES } = await import("../email-templates/email-templates.service.js");
  const trial = TEMPLATES.find((item) => item.key === "trial_expiring");
  const subscription = TEMPLATES.find((item) => item.key === "subscription_expiring");
  assert.equal(trial?.wired, true);
  assert.match(trial?.defaultBody ?? "", /\{\{timeLeft\}\}/);
  assert.equal(subscription?.wired, true);
  assert.match(subscription?.defaultBody ?? "", /\{\{timeLeft\}\}/);
});
```

- [x] **Step 2: Write the failing cron key test**

Append to `subscription-maintenance.cron.test.ts`:

```ts
let cron: typeof import("./subscription-maintenance.cron.js") | null = null;
try { cron = await import("./subscription-maintenance.cron.js"); } catch { /* RED: helper is not implemented yet */ }

test("Telegram and email expiry reminders use independent deduplication keys", () => {
  assert.equal(typeof cron?.expiryReminderKey, "function");
  if (!cron) return;
  const expireAt = new Date("2026-07-28T12:00:00.000Z");
  assert.notEqual(
    cron.expiryReminderKey("telegram", "paid", 180, expireAt),
    cron.expiryReminderKey("email", "paid", 180, expireAt),
  );
  assert.match(cron.expiryReminderKey("email", "trial", 1440, expireAt), /^email:trial-expiry:1440:/);
  assert.equal(expiryReminderOffset(expireAt, new Date("2026-07-27T12:00:00.000Z"), parseReminderHours("24")), 1440);
});
```

- [x] **Step 3: Run the focused tests and verify RED**

Run:

```bash
cd backend
rtk npm exec -- tsx --test src/modules/notification/expiry-email-notify.service.test.ts src/modules/subscription/subscription-maintenance.cron.test.ts
```

Expected: the new assertions fail because `expiry-email-notify.service.ts`, the two templates, and `expiryReminderKey` are not implemented. Existing reminder assertions must remain passing; if the command crashes instead of reporting the missing behavior, fix the test harness before writing production code.

## Task 2: Implement email formatting, template catalog, and Resend transport

**Files:**

- Create: `backend/src/modules/notification/expiry-email-notify.service.ts`
- Modify: `backend/src/modules/email-templates/email-templates.service.ts`
- Test: `backend/src/modules/notification/expiry-email-notify.service.test.ts`

**Interfaces:**

- Consumes: `mailConfigFromSystem`, `isMailConfigured`, `sendEmail`, `renderEmailTemplate`.
- Produces: The four exported helpers in the Interfaces section and a boolean send boundary used by the cron.

- [x] **Step 1: Implement the minimum pure helpers**

Add `ExpiryEmailKind`, `expiryEmailTemplateKey`, and `formatExpiryEmailTime`. Use `24`-hour multiples as days, otherwise hours, otherwise minutes; use readable Russian units (`день/дня/дней`, `час/часа/часов`, `минута/минуты/минут`) without introducing a library.

Implement `buildExpiryEmailVariables` with these exact behaviors:

```ts
const base = (config.publicAppUrl ?? "").trim().replace(/\/+$/, "");
return {
  serviceName: escapeHtml(config.serviceName?.trim() || "Лазейка ВПН"),
  trialName: escapeHtml(name),
  tariffName: escapeHtml(name),
  timeLeft: formatExpiryEmailTime(minutesLeft),
  daysLeft: String(Math.max(1, Math.ceil(minutesLeft / 1440))),
  renewUrl: `${base}/cabinet`,
};
```

Escape user/config values before inserting them into HTML templates. The `kind` argument chooses the template key but does not remove either name variable, preserving custom templates that use the other variable.

- [x] **Step 2: Run the focused tests and verify GREEN for the pure helpers**

Run:

```bash
cd backend
rtk npm exec -- tsx --test src/modules/notification/expiry-email-notify.service.test.ts
```

Expected: the time, URL/escaping, and template-key assertions pass; the catalog assertion may remain RED until Step 3.

- [x] **Step 3: Add the `trial_expiring` template and wire `subscription_expiring`**

In `TEMPLATES`:

1. Add `trial_expiring` with variables `trialName`, `timeLeft`, `renewUrl`, `serviceName`, default subject `Пробный доступ заканчивается через {{timeLeft}} — {{serviceName}}`, and a body that clearly says the trial is ending and uses buttons labeled `Выбрать тариф`.
2. Change `subscription_expiring.wired` to `true`, add `timeLeft` to its variables, and update the default subject/body to say the tariff ends in `{{timeLeft}}`; keep `daysLeft` in the variables list for stored custom templates.
3. Keep both bodies table-based through the existing `layout`, `button`, and `linkFallback` helpers.

- [x] **Step 4: Implement `sendExpiryReminderEmail` through the existing provider switch**

Implement this exact flow:

```ts
const mailConfig = mailConfigFromSystem(config);
if (!isMailConfigured(mailConfig) || !config.publicAppUrl?.trim() || !to.trim()) return false;
const rendered = await renderEmailTemplate(expiryEmailTemplateKey(kind), buildExpiryEmailVariables(kind, name, minutesLeft, config));
if (!rendered) return false;
const result = await sendEmail(mailConfig, to.trim(), rendered.subject, rendered.body);
if (!result.ok) console.warn("[expiry email] send failed", result.error ?? "unknown error");
return result.ok;
```

For the user's Resend setup, `mailConfig.provider === "resend"` and `sendEmail` will route to the existing Resend implementation; no code path may call Resend directly from the reminder service.

- [x] **Step 5: Run the focused tests again**

Run:

```bash
cd backend
rtk npm exec -- tsx --test src/modules/notification/expiry-email-notify.service.test.ts
```

Expected: all new email helper/template tests pass.

## Task 3: Add schema and system-setting storage

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260808120000_add_expiry_reminder_keys/migration.sql`
- Modify: `backend/src/modules/client/client.service.ts`
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**

- Consumes: Existing `system_settings` loader/update loops and Prisma `Subscription` model.
- Produces: Runtime config fields `trialExpiryEmailReminderEnabled`, `trialExpiryEmailReminderHours`, `subscriptionExpiryEmailReminderEnabled`, `subscriptionExpiryEmailReminderHours`; Prisma fields `expiryReminderKey` and `expiryEmailReminderKey`.

- [x] **Step 1: Add nullable Prisma fields and migration SQL**

Add after `lastNotifiedKey`:

```prisma
expiryReminderKey      String? @map("expiry_reminder_key")
expiryEmailReminderKey String? @map("expiry_email_reminder_key")
```

Create the migration with only:

```sql
ALTER TABLE "subscriptions" ADD COLUMN "expiry_reminder_key" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "expiry_email_reminder_key" TEXT;
```

- [x] **Step 2: Register and parse the four system settings**

Add all four snake-case keys to `SYSTEM_CONFIG_KEYS`. In `loadSystemConfigFromDb`, use these exact defaults:

```ts
trialExpiryEmailReminderEnabled: (map.trial_expiry_email_reminder_enabled ?? "true") !== "false",
trialExpiryEmailReminderHours: (map.trial_expiry_email_reminder_hours ?? "").trim() || "24",
subscriptionExpiryEmailReminderEnabled: (map.subscription_expiry_email_reminder_enabled ?? "true") !== "false",
subscriptionExpiryEmailReminderHours: (map.subscription_expiry_email_reminder_hours ?? "").trim() || "24",
```

- [x] **Step 3: Add admin validation and persistence**

Add the fields to `updateSettingsSchema` as two optional booleans and two optional strings with `.max(500)`. Add one boolean loop and one string loop beside the existing Telegram reminder persistence, mapping camelCase to snake_case and serializing booleans as `"true"`/`"false"`.

- [x] **Step 4: Extend frontend settings types**

Add the four optional fields to both `UpdateSettingsInput` and `AdminSettings` in `frontend/src/lib/api.ts`. Do not add a second settings endpoint; the existing `api.updateSettings` PATCH remains the boundary.

- [x] **Step 5: Generate Prisma client and type-check the backend**

Run:

```bash
cd backend
rtk npm exec -- prisma generate
rtk npm run build
```

Expected: Prisma client generation and TypeScript compilation succeed with the new model/config fields.

## Task 4: Integrate independent Telegram/email cron delivery

**Files:**

- Modify: `backend/src/modules/subscription/subscription-maintenance.cron.ts`
- Modify: `backend/src/modules/subscription/subscription-maintenance.cron.test.ts`
- Test: `backend/src/modules/notification/expiry-email-notify.service.test.ts`

**Interfaces:**

- Consumes: The Task 2 email service, Task 3 Prisma/config fields, existing `notifyTrialExpiry`/`notifySubscriptionExpiry` and `expiryReminderOffset`.
- Produces: One cron pass that can send Telegram and email independently without touching `lastNotifiedKey`.

- [x] **Step 1: Implement and test `expiryReminderKey`**

Return `${channel}:${kind}-expiry:${offset}:${expireAt.toISOString()}`. Run the cron focused test from Task 1 and confirm its RED assertion becomes GREEN before integrating the loop.

- [x] **Step 2: Build independent offset lists**

In `notifyExpiringSubscriptions`:

```ts
const emailConfigured = Boolean(
  (config.publicAppUrl ?? "").trim()
  && isMailConfigured(mailConfigFromSystem(config)),
);
const trialEmailOffsets = emailConfigured && config.trialExpiryEmailReminderEnabled
  ? parseReminderHours(config.trialExpiryEmailReminderHours, "24")
  : [];
const paidEmailOffsets = emailConfigured && config.subscriptionExpiryEmailReminderEnabled
  ? parseReminderHours(config.subscriptionExpiryEmailReminderHours, "24")
  : [];
```

Keep existing Telegram offset behavior unchanged. Compute `maxOffset` across all four lists; return `0` only when every list is empty.

- [x] **Step 3: Broaden the owner selection without sending to empty channels**

Change the subscription relation filter to require `telegramId` **or** `email`, and select both fields:

```ts
owner: {
  select: { telegramId: true, email: true, trialUsed: true },
},
```

The final `where` relation must still exclude deleted/gift subscriptions exactly as before.

- [x] **Step 4: Send and deduplicate Telegram separately**

For a due Telegram offset, claim with `expiryReminderKey("telegram", kind, offset, expireAt)` and update only `expiryReminderKey`. Keep the existing text/button arguments and increment the existing sent counter only after the current Telegram send path completes.

- [x] **Step 5: Send and deduplicate email separately**

For a due email offset and non-empty `owner.email`:

1. Claim `expiryEmailReminderKey` with the email key.
2. Call `sendExpiryReminderEmail(config, kind === "trial" ? "trial" : "subscription", owner.email, displayName, offset)`.
3. If it returns `false`, clear the key only when it still equals the claimed key so a later five-minute run can retry.
4. Do not throw from the loop and do not change the Telegram key.

- [x] **Step 6: Run the focused backend tests**

Run:

```bash
cd backend
rtk npm exec -- tsx --test src/modules/notification/expiry-email-notify.service.test.ts src/modules/subscription/subscription-maintenance.cron.test.ts
```

Expected: all focused tests pass, including independent email/Telegram key assertions.

## Task 5: Add the settings controls in the existing admin page

**Files:**

- Modify: `frontend/src/pages/settings.tsx`
- Test: frontend TypeScript/Vite build

**Interfaces:**

- Consumes: Task 3 `AdminSettings` fields and the existing reminder-card state/update pattern.
- Produces: A switch and hours input for email inside both existing reminder cards; `api.updateSettings` persists the values.

- [x] **Step 1: Add email fields to the save payload**

Immediately after each Telegram reminder group in `handleSubmit`, send:

```ts
trialExpiryEmailReminderEnabled: settings.trialExpiryEmailReminderEnabled !== false,
trialExpiryEmailReminderHours: settings.trialExpiryEmailReminderHours ?? "24",
subscriptionExpiryEmailReminderEnabled: settings.subscriptionExpiryEmailReminderEnabled !== false,
subscriptionExpiryEmailReminderHours: settings.subscriptionExpiryEmailReminderHours ?? "24",
```

- [x] **Step 2: Extend each reminder-card model**

Add `emailEnabled` and `emailHours` to the trial/subscription objects, using `!== false` and `?? "24"` defaults. Add the corresponding `onCheckedChange` and `onChange` branches so trial writes only trial fields and subscription writes only subscription fields.

- [x] **Step 3: Render the compact email controls**

Below the existing message fields in each card, render a bordered row with the already imported `Mail` icon, label `Напоминать по email`, a `Switch`, and an `Input` labeled `За сколько часов`. Disable the interval input while the email switch is off. Add the hint `По умолчанию: одно письмо за 24 часа. Текст настраивается в разделе «Почта → Шаблоны».`

- [x] **Step 4: Build the frontend**

Run:

```bash
cd frontend
rtk npm run build
```

Expected: TypeScript and Vite build succeed with no missing settings properties or JSX errors.

## Task 6: Full verification and implementation commit

**Files:**

- Verify all files listed above.
- Do not stage unrelated user files.

- [x] **Step 1: Run the complete backend test suite**

Run:

```bash
cd backend
rtk npm test
```

Expected: exit code `0`, zero failed tests, and no TypeScript/runtime errors in the test output.

- [x] **Step 2: Regenerate Prisma and run both builds from clean generated code**

Run:

```bash
cd backend
rtk npm exec -- prisma generate
rtk npm run build
cd ../frontend
rtk npm run build
```

Expected: all commands exit `0`. This specifically verifies the Resend-enabled mail config type reaches the new sender and the UI payload matches the backend schema.

- [x] **Step 3: Inspect the final diff and migration**

Run:

```bash
cd ..
rtk git diff --check
rtk git diff --stat
rtk git status --short
```

Confirm the diff contains only the approved reminder feature, the design/plan docs, and no changes to `.vscode/settings.json`, `AGENTS.md`, or the unrelated public-whitelist plan.

- [x] **Step 4: Stage only feature files and verify the staged diff**

Run `rtk git add` with the exact implementation paths from the File Map, then:

```bash
rtk git diff --cached --check
rtk git diff --cached --stat
```

Expected: no whitespace errors and no unrelated files staged.

- [x] **Step 5: Create the implementation commit**

```bash
rtk git commit -m "feat: add email expiry reminders"
```

After the commit, run `rtk git status --short --branch` and report the commit hash plus the fresh test/build evidence. Do not push or alter unrelated work.

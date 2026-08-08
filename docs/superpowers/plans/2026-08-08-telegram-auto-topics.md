# Telegram Auto-Created Notification Topics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create named Telegram forum topics automatically when notification groups are saved, persist their IDs, and route every admin notification category—including revoked subscriptions—to the correct topic.

**Architecture:** Add one small backend module containing the stable topic definitions, Telegram `createForumTopic` call, and an idempotent ensure helper with an injectable request function for tests. The admin settings route will clear topic IDs only when their owning group changes, then call the helper after settings persistence. Existing senders and system-setting storage remain the source of truth; the frontend only exposes the additional revoked-subscription field and explains that empty IDs are created automatically.

**Tech Stack:** Node.js 22, TypeScript/ESM, Node built-in test runner, Telegram Bot API, Prisma `systemSetting`, existing `proxyFetch`/Telegram proxy.

## Global Constraints

- Work directly on the `main` branch as requested.
- Preserve unrelated existing changes in `.vscode/settings.json`, `AGENTS.md`, and the existing untracked plan file.
- Do not add dependencies or a database migration.
- Preserve manually entered topic IDs unless the owning group ID changes.
- Use the existing Telegram proxy path and `message_thread_id` send behavior.
- Do not create topics for client-only reminders, traffic milestones, or client auto-renewal messages.

---

### Task 1: Add topic definitions and a testable Telegram topic helper

**Files:**
- Create: `backend/src/modules/notification/telegram-topics.ts`
- Test: `backend/src/modules/notification/telegram-topics.test.ts`

**Interfaces:**
- Produces `MAIN_TELEGRAM_NOTIFICATION_TOPICS`, an immutable list of `{ settingKey, name }` entries for the 11 main-group settings.
- Produces `MANAGERS_TELEGRAM_NOTIFICATION_TOPIC` for `notification_managers_topic_tickets` and `🎫 Тикеты менеджеров`.
- Produces `getTelegramTopicResetKeys(mainGroupChanged: boolean, managersGroupChanged: boolean): string[]`.
- Produces `ensureTelegramNotificationTopics(input)` where `input` contains the bot token, main group ID, managers group ID, current topic IDs, a `setTopicId(settingKey, id)` callback, and an optional Telegram request function.

- [ ] **Step 1: Write the failing tests**

```ts
test("defines all main and managers topic names", () => {
  assert.deepEqual(MAIN_TELEGRAM_NOTIFICATION_TOPICS.map((topic) => topic.name), [
    "👤 Новые клиенты",
    "💳 Платежи",
    "🎫 Тикеты",
    "💾 Авто-бэкапы",
    "🎁 Пробный период",
    "🔄 Конвертации",
    "💸 Заявки на вывод",
    "🏷 Промокоды",
    "🎟 Подарки",
    "⚠️ Сбои автосписания",
    "⛔ Аннулирование подписок",
  ]);
  assert.equal(MANAGERS_TELEGRAM_NOTIFICATION_TOPIC.name, "🎫 Тикеты менеджеров");
});

test("creates only missing topics and stores returned IDs", async () => {
  const calls: Array<{ chatId: string; name: string }> = [];
  const saved: Record<string, string> = {};
  await ensureTelegramNotificationTopics({
    botToken: "token",
    groupId: "-1001",
    managersGroupId: "",
    topicIds: { notification_topic_payments: "42" },
    setTopicId: async (key, id) => { saved[key] = id; },
    request: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ chatId: body.chat_id, name: body.name });
      return Response.json({ ok: true, result: { message_thread_id: 100 + calls.length } });
    },
  });
  assert.equal(calls.length, 10);
  assert.equal(saved.notification_topic_payments, undefined);
  assert.equal(saved.notification_topic_new_clients, "101");
});

test("propagates Telegram topic creation errors", async () => {
  await assert.rejects(
    ensureTelegramNotificationTopics({
      botToken: "token",
      groupId: "-1001",
      managersGroupId: "",
      topicIds: {},
      setTopicId: async () => undefined,
      request: async () => Response.json({ ok: false, description: "Bad Request: not a forum" }),
    }),
    /not a forum/,
  );
});

test("resets main or managers IDs only for the group that changed", () => {
  assert.deepEqual(getTelegramTopicResetKeys(true, false), MAIN_TELEGRAM_NOTIFICATION_TOPICS.map((topic) => topic.settingKey));
  assert.deepEqual(getTelegramTopicResetKeys(false, true), ["notification_managers_topic_tickets"]);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `cd backend && npm test -- src/modules/notification/telegram-topics.test.ts`

Expected: FAIL because `telegram-topics.ts` and its exported definitions/functions do not exist yet.

- [ ] **Step 3: Implement the minimal helper**

Use the existing `proxyFetch` and `getProxyUrl("telegram")` for the default request. Post JSON to `https://api.telegram.org/bot${botToken}/createForumTopic` with `{ chat_id: groupId, name }`. Require `ok === true` and a positive integer `result.message_thread_id`; otherwise throw an error containing Telegram’s `description`. Skip empty group IDs, preserve non-empty topic IDs, and save each newly returned ID through `setTopicId` immediately after creation.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `cd backend && npm test -- src/modules/notification/telegram-topics.test.ts`

Expected: PASS with all topic-helper tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/notification/telegram-topics.ts backend/src/modules/notification/telegram-topics.test.ts
git commit -m "feat: add Telegram notification topic helper"
```

### Task 2: Wire the new category and automatic creation into backend settings

**Files:**
- Modify: `backend/src/modules/client/client.service.ts:107-118,232,639-651`
- Modify: `backend/src/modules/notification/telegram-notify.service.ts:57-173`
- Modify: `backend/src/modules/admin/admin.routes.ts:3339-3352,3635-3875,4660-4680`
- Test: `backend/src/modules/notification/telegram-topics.test.ts`

**Interfaces:**
- Consumes the topic definitions and `ensureTelegramNotificationTopics` from Task 1.
- Produces a persisted `notification_topic_subscription_revoked` setting and routes `subscription_revoked` to it.

- [ ] **Step 1: Add the failing regression assertion**

Extend `backend/src/modules/notification/telegram-topics.test.ts` with:

```ts
test("maps revoked subscription notifications to their dedicated setting", () => {
  assert.equal(getTopicIdForEvent({ notificationTopicSubscriptionRevoked: "77" }, "subscription_revoked"), 77);
});
```

Export `getTopicIdForEvent` from `telegram-notify.service.ts` and import it into the test.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `cd backend && npm test -- src/modules/notification/telegram-topics.test.ts`

Expected: FAIL with `null !== 77`, because `getTopicIdForEvent` currently has no `subscription_revoked` case.

- [ ] **Step 3: Implement backend wiring**

Add `notification_topic_subscription_revoked` to `SYSTEM_CONFIG_KEYS` and return `notificationTopicSubscriptionRevoked` from `loadSystemConfigFromDb`. Add the `subscription_revoked` case to `getTopicIdForEvent`.

Extend `updateSettingsSchema` and the `topicKeys` array with `notificationTopicSubscriptionRevoked` → `notification_topic_subscription_revoked`. The frontend `UpdateSettingsPayload` type is updated in Task 3.

Before updating group IDs, read the previous main and managers group values. After normal topic fields are written:

```ts
const mainGroupChanged = updates.notificationTelegramGroupId !== undefined && previousMainGroupId !== nextMainGroupId;
const managersGroupChanged = updates.notificationManagersGroupId !== undefined && previousManagersGroupId !== nextManagersGroupId;
for (const key of getTelegramTopicResetKeys(mainGroupChanged, managersGroupChanged)) {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: "" }, update: { value: "" } });
}
```

Invalidate the config cache, load the fresh config, and call `ensureTelegramNotificationTopics` only when a main/manager group is configured and a bot token is available. Catch its error and return HTTP 400 with the readable error message, then invalidate/load once more and return the final config containing the generated IDs. If no group is configured, skip topic setup.

- [ ] **Step 4: Run focused tests and build**

Run: `cd backend && npm test -- src/modules/notification/telegram-topics.test.ts && npm run build`

Expected: PASS and TypeScript compilation exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/client/client.service.ts backend/src/modules/notification/telegram-notify.service.ts backend/src/modules/admin/admin.routes.ts backend/src/modules/notification/telegram-topics.test.ts
git commit -m "feat: auto-create Telegram notification topics"
```

### Task 3: Expose the revoked-subscription topic in the admin settings UI

**Files:**
- Modify: `frontend/src/lib/api.ts:3335-3348,3915-3928`
- Modify: `frontend/src/pages/settings.tsx:866-878,1320-1410`
- Modify: `frontend/src/i18n/locales/ru.json:1059-1071`
- Modify: `frontend/src/i18n/locales/en.json:1059-1071`

**Interfaces:**
- Consumes the backend setting from Task 2.
- Produces a visible `Аннулирование подписок` / `Subscription revocations` field and submits its stored ID without changing existing fields.

- [ ] **Step 1: Add the frontend field and copy**

Add `notificationTopicSubscriptionRevoked?: string | null` to both API types, load it into the settings state, include it in the update payload, and render one field beside the existing topic fields. Add `topic_subscription_revoked` to both locale files. Update `topics_hint` to say that empty IDs are created automatically when the settings are saved; retain the ID inputs for manual compatibility.

- [ ] **Step 2: Run the frontend build**

Run: `cd frontend && npm run build`

Expected: the frontend compiles with the new optional field in both the response and update payload types.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/settings.tsx frontend/src/i18n/locales/ru.json frontend/src/i18n/locales/en.json
git commit -m "feat: show automatic Telegram topic settings"
```

### Task 4: Run the complete verification suite

**Files:**
- Verify: all files changed in Tasks 1–3.

- [ ] **Step 1: Run the focused backend regression test**

Run: `cd backend && npm test -- src/modules/notification/telegram-topics.test.ts`

Expected: all topic creation, preservation, error, reset, and revoked-subscription mapping tests pass.

- [ ] **Step 2: Run the full backend test suite**

Run: `cd backend && npm test`

Expected: exit code 0 with no failed tests.

- [ ] **Step 3: Run backend and frontend builds**

Run the backend `npm run build` and the frontend build command from its package scripts.

Expected: both builds exit with code 0.

- [ ] **Step 4: Inspect the final diff and repository state**

Run: `git diff main --stat`, `git diff main --check`, and `git status --short`.

Expected: only the intended feature commits are present; unrelated pre-existing changes remain untouched; `git diff --check` emits no whitespace errors.

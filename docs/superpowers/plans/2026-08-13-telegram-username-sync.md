# Telegram Username Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a client's stored Telegram username current when Telegram supplies a changed non-empty value through Mini App or bot activity.

**Architecture:** Mini App updates during its existing signed authentication request. Bot activity passes through one shared middleware backed by an in-memory last-seen map, then calls one bot-authenticated backend endpoint only for the first observed or changed non-empty username; the database update itself is conditional.

**Tech Stack:** TypeScript, Express, Prisma, grammY, Node.js `node:test`/`assert`.

## Global Constraints

- Never clear `Client.telegramUsername` when Telegram omits or removes the username.
- No cron jobs, Telegram API polling, database migration, or new dependency.
- Username synchronization is best-effort and must not prevent the user's requested bot action.
- Preserve the product name **Лазейка ВПН**; existing `stealthnet` technical identifiers remain unchanged.

---

### Task 1: Conditional backend updates for Mini App and bot activity

**Files:**
- Create: `backend/src/modules/client/telegram-username-sync.contract.test.ts`
- Modify: `backend/src/modules/client/client.routes.ts:874-920,7898-7920`

**Interfaces:**
- Consumes: existing `extractBotTokenFromRequest(req)`, `getBotByToken(token)`, `prisma.client.update`, and `prisma.client.updateMany`.
- Produces: `POST /api/public/sync-telegram-username` with body `{ telegramId: number; telegramUsername: string }` and response `{ updated: boolean }`.

- [ ] **Step 1: Write the failing backend contract tests**

Create a source-contract test following the existing client-module test style:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("./client.routes.ts", import.meta.url), "utf8");

test("Mini App updates only a changed non-empty Telegram username", () => {
  const start = routes.indexOf('clientAuthRouter.post("/telegram-miniapp"');
  const end = routes.indexOf('clientAuthRouter.post("/2fa-login"', start);
  const block = routes.slice(start, end);
  assert.match(block, /telegramUsername\s*&&\s*telegramUsername\s*!==\s*existing\.telegramUsername/);
  assert.match(block, /data:\s*\{\s*telegramUsername\s*\}/);
});

test("bot username sync is authenticated and updates only a differing value", () => {
  const start = routes.indexOf('publicConfigRouter.post("/sync-telegram-username"');
  assert.ok(start >= 0);
  const end = routes.indexOf("\n/**", start);
  const block = routes.slice(start, end > start ? end : undefined);
  assert.match(block, /extractBotTokenFromRequest/);
  assert.match(block, /getBotByToken/);
  assert.match(block, /telegramUsername:\s*\{\s*not:\s*telegramUsername\s*\}/);
  assert.match(block, /data:\s*\{\s*telegramUsername\s*\}/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd backend && npm exec -- tsx --test src/modules/client/telegram-username-sync.contract.test.ts`

Expected: FAIL because Mini App has no conditional update and `/sync-telegram-username` does not exist.

- [ ] **Step 3: Add the minimal Mini App update**

Immediately after the existing-client blocked check, update the already selected object only when Telegram supplied a different non-empty value:

```ts
if (telegramUsername && telegramUsername !== existing.telegramUsername) {
  await prisma.client.update({
    where: { id: existing.id },
    data: { telegramUsername },
  });
  existing.telegramUsername = telegramUsername;
}
```

This preserves the old value when `tgUser.username` is missing.

- [ ] **Step 4: Add the authenticated bot synchronization endpoint**

Place the schema and route alongside the existing bot-authenticated public routes:

```ts
const syncTelegramUsernameSchema = z.object({
  telegramId: z.number().int(),
  telegramUsername: z.string().trim().min(1).max(32),
});

publicConfigRouter.post("/sync-telegram-username", async (req, res) => {
  const token = extractBotTokenFromRequest(req as Parameters<typeof extractBotTokenFromRequest>[0]);
  if (!token || !(await getBotByToken(token))) {
    return res.status(401).json({ message: "Недействительный токен бота" });
  }
  const body = syncTelegramUsernameSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Проверьте данные Telegram" });
  const { telegramId, telegramUsername } = body.data;
  const result = await prisma.client.updateMany({
    where: {
      telegramId: String(telegramId),
      OR: [
        { telegramUsername: null },
        { telegramUsername: { not: telegramUsername } },
      ],
    },
    data: { telegramUsername },
  });
  return res.json({ updated: result.count > 0 });
});
```

The route does not create a missing client and performs no write when the stored value is already equal.

- [ ] **Step 5: Run backend checks and verify GREEN**

Run:

```bash
cd backend
npm exec -- tsx --test src/modules/client/telegram-username-sync.contract.test.ts
npm run build
```

Expected: the new tests pass and TypeScript compilation exits successfully.

- [ ] **Step 6: Commit the backend behavior**

```bash
git add backend/src/modules/client/client.routes.ts backend/src/modules/client/telegram-username-sync.contract.test.ts
git commit -m "feat: sync telegram username in backend"
```

### Task 2: Deduplicated username synchronization in the bot

**Files:**
- Create: `bot/src/telegram-username-sync.ts`
- Create: `bot/src/telegram-username-sync.test.ts`
- Modify: `bot/src/api.ts:310-325`
- Modify: `bot/src/index.ts:1-165`

**Interfaces:**
- Consumes: `POST /api/public/sync-telegram-username` from Task 1 and grammY `ctx.from`.
- Produces: `createTelegramUsernameSync(send): (telegramId: number, username?: string) => Promise<void>` and `api.syncTelegramUsername(telegramId, telegramUsername)`.

- [ ] **Step 1: Write the failing in-memory synchronization tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createTelegramUsernameSync } from "./telegram-username-sync.js";

test("syncs first and changed non-empty usernames only", async () => {
  const calls: Array<[number, string]> = [];
  const sync = createTelegramUsernameSync(async (id, username) => { calls.push([id, username]); });
  await sync(7, "first_name");
  await sync(7, "first_name");
  await sync(7, undefined);
  await sync(7, "second_name");
  assert.deepEqual(calls, [[7, "first_name"], [7, "second_name"]]);
});

test("retries a username after a failed request", async () => {
  let attempts = 0;
  const sync = createTelegramUsernameSync(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("offline");
  });
  await assert.rejects(sync(7, "name"), /offline/);
  await sync(7, "name");
  assert.equal(attempts, 2);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd bot && npm exec -- tsx --test src/telegram-username-sync.test.ts`

Expected: FAIL because `telegram-username-sync.ts` does not exist.

- [ ] **Step 3: Implement the smallest deduplicating synchronizer**

```ts
type SendUsername = (telegramId: number, username: string) => Promise<unknown>;

export function createTelegramUsernameSync(send: SendUsername) {
  const seen = new Map<number, string>();
  return async (telegramId: number, username?: string): Promise<void> => {
    const value = username?.trim();
    if (!value || seen.get(telegramId) === value) return;
    seen.set(telegramId, value);
    try {
      await send(telegramId, value);
    } catch (error) {
      if (seen.get(telegramId) === value) seen.delete(telegramId);
      throw error;
    }
  };
}
```

Setting the map before awaiting also deduplicates concurrent identical updates; deleting on failure permits retry.

- [ ] **Step 4: Add the bot API call**

```ts
export async function syncTelegramUsername(
  telegramId: number,
  telegramUsername: string,
): Promise<{ updated: boolean }> {
  return fetchJson("/api/public/sync-telegram-username", {
    method: "POST",
    body: { telegramId, telegramUsername },
  });
}
```

The existing `fetchJson` headers already include `X-Telegram-Bot-Token`.

- [ ] **Step 5: Install the shared middleware once**

Import the factory and place the middleware immediately after `botErrorContext` setup:

```ts
import { createTelegramUsernameSync } from "./telegram-username-sync.js";

const syncTelegramUsername = createTelegramUsernameSync(api.syncTelegramUsername);
composer.use(async (ctx, next) => {
  if (ctx.from?.username) {
    await syncTelegramUsername(ctx.from.id, ctx.from.username).catch(() => {});
  }
  return next();
});
```

This covers commands, messages, and callback queries while failures remain invisible to the user's action.

- [ ] **Step 6: Run bot and full compile checks**

Run:

```bash
cd bot
npm exec -- tsx --test src/telegram-username-sync.test.ts
npm test
npm run build
cd ../backend
npm exec -- tsx --test src/modules/client/telegram-username-sync.contract.test.ts
```

Expected: all bot tests, both builds/checks already run, and the focused backend regression test pass.

- [ ] **Step 7: Commit the bot behavior**

```bash
git add bot/src/api.ts bot/src/index.ts bot/src/telegram-username-sync.ts bot/src/telegram-username-sync.test.ts
git commit -m "feat: sync changed telegram usernames"
```

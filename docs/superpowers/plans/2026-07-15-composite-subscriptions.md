# Composite Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each STEALTHNET subscription a controllable composite of Remnawave users with one stable public URL and complete UI/API support.

**Architecture:** `Subscription` stays the logical product owned by STEALTHNET. `RemnawaveComponent` records every upstream user and its snapshot; one internal component service is the only writer to Remnawave. A public route resolves the existing `bot.lazeika.xyz/api/sub/{token}` URL, and all staff/user surfaces consume a single logical-subscription read model.

**Tech Stack:** Node 22, TypeScript, Express, Prisma/PostgreSQL, React/Vite, grammY, existing Remnawave HTTP client.

## Global Constraints

- STEALTHNET is the only source of truth; Remnawave only executes and reports technical state.
- Preserve every existing `Subscription`, its index, `remnawaveUuid`, payment/gift/trial relations, and public URL token.
- A user sees only the stable `https://bot.lazeika.xyz/api/sub/{token}` URL, never UUIDs or upstream URLs.
- A logical subscription has exactly one required component; optional component failure must not break the required component.
- Revoke means revoke every Remnawave component, then remove only that logical subscription; it must not affect the user’s other indexes.
- Notify the user only through Telegram bot; send success, failure, and reconciliation results to the configured Telegram notification channel.
- Do not add dependencies or a standalone process; use existing Prisma, `remna.client.ts`, `sync.service.ts`, notification service, and frontend primitives.
- Stop after each phase below and wait for the user’s explicit `продолжать` before starting the next phase.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `backend/prisma/schema.prisma` | Component, template, token and sync persistence model. |
| `backend/prisma/migrations/20260715*_composite_subscriptions/migration.sql` | Additive schema migration and idempotent component/token backfill. |
| `backend/src/modules/subscription/subscription.helpers.ts` | Legacy fallback, token lookup, logical subscription read helpers. |
| `backend/src/modules/subscription/subscription-components.service.ts` | The single writer for component creation, update, delete, revoke, sync and aggregated read state. |
| `backend/src/modules/subscription/public-subscription.routes.ts` | `GET /api/sub/:token`, header allowlist and safe response merging. |
| `backend/src/modules/subscription/subscription-contract.ts` | Shared backend read-model and zod request schemas. |
| `backend/src/modules/remna/remna.client.ts` | Raw upstream subscription fetch plus existing user operations only. |
| `backend/src/modules/tariff/tariff-activation.service.ts` | Materialise/update components from tariff snapshots during all paid/trial flows. |
| `backend/src/modules/client/client.routes.ts` | Client read/action endpoints based on `subscriptionId`, not root/secondary. |
| `backend/src/modules/admin/admin.routes.ts` | Admin component CRUD and logical actions; remove direct one-UUID mutations. |
| `backend/src/modules/bot-admin/bot-admin.routes.ts` | Bot-admin equivalents delegated to the logical action service. |
| `backend/src/modules/sync/sync.service.ts` | Reconcile pending/error component operations and no longer create a Client per component UUID. |
| `backend/src/modules/notification/telegram-notify.service.ts` | User revoke notice and administrator-channel operation notice. |
| `backend/src/app.ts` | Mount the public route before SPA fallback. |
| `frontend/src/lib/api.ts` | One typed logical-subscription API contract. |
| `frontend/src/components/admin/subscription-remna-panel.tsx` | Component table and actions inside a logical subscription. |
| `frontend/src/components/admin/client-subscriptions-tab.tsx` | Logical subscription list, public URL and subscription-level actions. |
| `frontend/src/pages/clients.tsx` | Consume the revised admin client-subscription contract. |
| `frontend/src/pages/cabinet/client-dashboard.tsx` and `frontend/src/pages/cabinet/client-profile.tsx` | Display logical subscriptions and public URLs only. |
| `frontend/src/pages/cabinet/client-subscribe.tsx`, `frontend/src/components/payment/extend-subscription-dialog.tsx` | Select and extend by `subscriptionId`. |
| `frontend/src/pages/cabinet/client-gifts.tsx` | Keep gifts tied to the logical subscription, without exposing a component UUID. |
| `bot/src/api.ts`, `bot/src/index.ts`, `bot/src/keyboard.ts` | Render and act on logical subscriptions; send user revoke notifications. |
| `backend/src/modules/subscription/*.test.ts`, `bot/src/keyboard.test.ts` | New pure merge/service tests and bot callback regression tests. |

## Phase 1 — Persistence and Compatibility Foundation

### Task 1: Add an additive component data model

**Files:**
- Modify: `backend/prisma/schema.prisma:969-1053`
- Create: `backend/prisma/migrations/20260715090000_composite_subscriptions/migration.sql`
- Create: `backend/src/modules/subscription/subscription-components.model.test.ts`

**Interfaces:**

```ts
type ComponentSyncStatus = "SYNCED" | "PENDING" | "ERROR" | "PENDING_DELETE";
type ComponentSnapshot = {
  key: string; adminName: string; required: boolean; mergeOrder: number;
  internalSquadUuids: string[]; trafficLimitBytes: bigint | null;
  trafficResetMode: string; showQuotaToClient: boolean; quotaDisplayName: string | null;
};
```

- [ ] **Step 1: Write failing model-invariant tests**

```ts
test("legacy subscription materialises one required main component", async () => {
  const component = legacyComponent({ remnawaveUuid: "uuid-main" });
  assert.deepEqual(component, { key: "main", required: true, remnawaveUuid: "uuid-main" });
});

test("a component key is unique within its logical subscription", () => {
  assert.throws(() => validateComponentSet([main(), main()]));
});
```

- [ ] **Step 2: Run the test to establish the missing implementation**

Run: `cd backend && npx tsx --test src/modules/subscription/subscription-components.model.test.ts`
Expected: FAIL because component model helpers do not exist.

- [ ] **Step 3: Add Prisma models and constraints**

Add `publicSubscriptionToken`, sync fields and `components` relation to `Subscription`; add `RemnawaveComponent`, `TariffRemnawaveComponent`, and `TrialRemnawaveComponent`. Use unique `(subscriptionId,key)`, unique nullable `remnawaveUuid`, index `(subscriptionId,mergeOrder)`, and cascade delete. Keep `Subscription.remnawaveUuid` unchanged as required-component mirror.

- [ ] **Step 4: Write an idempotent migration**

The SQL must add columns/tables without dropping data; backfill one `main` component for every legacy subscription with a UUID; create a cryptographically random token only where no existing controlled public token exists; copy legacy tariff traffic/squad fields into the component snapshot. SQL must reject duplicate required components before adding the required unique/index constraints.

- [ ] **Step 5: Generate Prisma client and run the tests**

Run: `cd backend && npm run db:generate && npx tsx --test src/modules/subscription/subscription-components.model.test.ts && npm run build`
Expected: generated client, tests pass, TypeScript exits 0.

- [ ] **Step 6: Audit a migration dry run against a database copy**

Run the migration in the staging/copy environment and query: count legacy subscriptions, count created `main` components, missing tokens, duplicate component keys, and mismatched legacy/main UUIDs. All counts must be zero except the expected one-to-one backfill count.

- [ ] **Step 7: Commit Phase 1**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260715090000_composite_subscriptions backend/src/modules/subscription/subscription-components.model.test.ts
git commit -m "feat: persist composite subscription components"
```

**Phase gate:** stop and report the migration audit; do not deploy the migration to SSH bot.

## Phase 2 — Core Component Service and Public Subscription Route

### Task 2: Centralise all component mutations

**Files:**
- Create: `backend/src/modules/subscription/subscription-components.service.ts`
- Create: `backend/src/modules/subscription/subscription-contract.ts`
- Modify: `backend/src/modules/subscription/subscription.helpers.ts`
- Modify: `backend/src/modules/remna/remna.client.ts`
- Create: `backend/src/modules/subscription/subscription-components.service.test.ts`

**Interfaces:**

```ts
export async function getLogicalSubscription(subscriptionId: string): Promise<LogicalSubscription | null>;
export async function materializeComponents(subscriptionId: string, templates: ComponentSnapshot[]): Promise<SyncReport>;
export async function updateComponent(subscriptionId: string, key: string, patch: ComponentPatch): Promise<SyncReport>;
export async function revokeLogicalSubscription(subscriptionId: string, actorId: string): Promise<RevokeReport>;
export async function reconcileSubscription(subscriptionId: string): Promise<SyncReport>;
export function publicSubscriptionUrl(token: string): string;
```

- [ ] **Step 1: Write failing service tests**

```ts
test("revoke only calls Remnawave for components of the selected subscription", async () => {
  const report = await revokeLogicalSubscription("sub-0", "admin-1");
  assert.deepEqual(report.revokedUuids, ["uuid-main-0", "uuid-whitelist-0"]);
  assert.equal(await findSubscription("sub-1"), true);
});

test("failed component revoke leaves PENDING_DELETE and does not delete data", async () => {
  await assert.rejects(() => revokeLogicalSubscription("sub-0", "admin-1"));
  assert.equal((await getLogicalSubscription("sub-0"))?.syncStatus, "PENDING_DELETE");
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd backend && npx tsx --test src/modules/subscription/subscription-components.service.test.ts`
Expected: FAIL with missing module/functions.

- [ ] **Step 3: Implement the minimal single writer**

Use a Prisma transaction to record desired state before external calls. Reuse `remnaCreateUser`, `remnaUpdateUser`, `remnaDisableUser`, `remnaEnableUser`, `remnaResetUserTraffic`, `remnaRevokeUserSubscription`, and `remnaDeleteUser`; add only `remnaFetchSubscriptionRaw(url, headers)` to `remna.client.ts`. On a non-required failure, retain component + error and schedule reconciliation. On revoke, set `PENDING_DELETE`, invoke revoke for every component, delete the logical record only after all calls succeed.

- [ ] **Step 4: Implement legacy resolver and stable URL helper**

`getLogicalSubscription` must materialise an in-memory main component from `Subscription.remnawaveUuid` if backfill has not reached a row. `publicSubscriptionUrl` must use the existing configured public application URL and return `/api/sub/{token}`; no caller may compose a Remnawave URL.

- [ ] **Step 5: Run service tests and backend build**

Run: `cd backend && npx tsx --test src/modules/subscription/subscription-components.service.test.ts && npm run build`
Expected: all assertions pass and build exits 0.

### Task 3: Serve one merged public subscription

**Files:**
- Create: `backend/src/modules/subscription/public-subscription.routes.ts`
- Create: `backend/src/modules/subscription/public-subscription.routes.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**

```ts
export const publicSubscriptionRouter: Router;
export function pickForwardHeaders(headers: IncomingHttpHeaders): Record<string, string>;
export function mergeSubscriptionBodies(parts: UpstreamSubscription[]): MergedSubscription;
```

- [ ] **Step 1: Write failing request/merge tests**

```ts
test("base64 URI components merge once and preserve only allowed headers", async () => {
  const response = await getPublicSubscription("token-0", { "x-hwid": "h", cookie: "secret" });
  assert.equal(response.status, 200);
  assert.equal(response.forwardedHeaders.cookie, undefined);
  assert.match(decodeBase64(response.body), /uuid-main\n.*uuid-whitelist/);
});

test("failed optional component returns required body and records an error", async () => {
  const response = await getPublicSubscription("token-0");
  assert.equal(response.status, 200);
  assert.equal(response.usedComponents, 1);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd backend && npx tsx --test src/modules/subscription/public-subscription.routes.test.ts`
Expected: FAIL with missing router and merge functions.

- [ ] **Step 3: Implement the route**

Mount `GET /api/sub/:token` before the SPA route. Allowlist only `User-Agent`, `Accept`, `Accept-Language`, `X-HWID`, `X-Device-*`, `X-App-Version`, `X-Ver-OS`; do not forward auth, cookie, host or forwarding headers. Fetch required and optional upstreams with `Promise.allSettled`; merge valid Base64 URI lines, explicitly supported JSON arrays, and otherwise return the required body unchanged. Never log token or full HWID.

- [ ] **Step 4: Run route tests and build**

Run: `cd backend && npx tsx --test src/modules/subscription/public-subscription.routes.test.ts && npm run build`
Expected: all tests pass and build exits 0.

- [ ] **Step 5: Commit Phase 2**

```bash
git add backend/src/modules/subscription backend/src/modules/remna/remna.client.ts backend/src/app.ts
git commit -m "feat: add composite subscription gateway"
```

**Phase gate:** smoke-test an existing `bot.lazeika.xyz/api/sub/{token}` in staging; stop for user approval before activation/payment changes.

## Phase 3 — Issuance, Extension, Revoke, Reconciliation and Notifications

### Task 4: Route every lifecycle into the component service

**Files:**
- Modify: `backend/src/modules/tariff/tariff-activation.service.ts`
- Modify: `backend/src/modules/gift/gift.service.ts`
- Modify: `backend/src/modules/payment/auto-renew.cron.ts`
- Modify: `backend/src/modules/client/client.routes.ts`
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Modify: `backend/src/modules/bot-admin/bot-admin.routes.ts`
- Create: `backend/src/modules/subscription/subscription-lifecycle.test.ts`

**Interfaces:**

```ts
POST /api/admin/subscriptions/:subId/revoke
POST /api/admin/subscriptions/:subId/public-url/reissue
POST /api/admin/subscriptions/:subId/components
PATCH /api/admin/subscriptions/:subId/components/:key
DELETE /api/admin/subscriptions/:subId/components/:key
POST /api/admin/subscriptions/:subId/reconcile
```

- [ ] **Step 1: Write failing lifecycle tests for payment, gift, trial and admin grant**

```ts
test("tariff activation materialises all tariff component snapshots", async () => {
  await activateTariffForClient(input);
  assert.equal((await getLogicalSubscription(input.subscriptionId))?.components.length, 2);
});

test("admin revoke removes only the selected logical subscription and queues notices", async () => {
  const result = await adminRevoke("sub-0");
  assert.equal(result.deleted, true);
  assert.equal(notificationQueue.userTelegram, true);
  assert.equal(await findSubscription("sub-1"), true);
});
```

- [ ] **Step 2: Run lifecycle tests to verify failure**

Run: `cd backend && npx tsx --test src/modules/subscription/subscription-lifecycle.test.ts`
Expected: FAIL until every activation path calls the component service.

- [ ] **Step 3: Replace direct UUID writes**

Make `activateTariffForClient`, `extendSecondarySubscription`, gifts, trials and auto-renew call the service. Keep old route paths as compatibility adapters but delegate to logical actions; remove their direct `remnaRevokeUserSubscription`, enable/disable, unlink and URL responses. All client actions must accept `subscriptionId`, not `root|secondary`.

- [ ] **Step 4: Add precise notifications**

Extend `telegram-notify.service.ts` with `notifySubscriptionRevokedToClient` and `notifyCompositeOperationToAdmins`. Send client message only after complete revoke. Send channel message for success, partial failure, and reconciliation completion using subscription index, component key/UUID and scrubbed error.

- [ ] **Step 5: Run the lifecycle suite and backend build**

Run: `cd backend && npx tsx --test src/modules/subscription/subscription-lifecycle.test.ts && npm run build`
Expected: all tests pass and build exits 0.

### Task 5: Reconcile components without importing them as clients

**Files:**
- Modify: `backend/src/modules/sync/sync.service.ts`
- Modify: `backend/src/modules/diagnostics/cron-registry.ts`
- Create: `backend/src/modules/subscription/subscription-reconciliation.test.ts`

- [ ] **Step 1: Write failing reconciliation tests**

```ts
test("pending delete retries the failed component and deletes after all revoke calls succeed", async () => {
  await reconcileSubscription("sub-0");
  assert.equal(await getLogicalSubscription("sub-0"), null);
});

test("an imported component UUID never creates a second Client", async () => {
  await syncFromRemna();
  assert.equal(await countClientsByTelegramId("42"), 1);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd backend && npx tsx --test src/modules/subscription/subscription-reconciliation.test.ts`
Expected: FAIL until the sync path resolves components first.

- [ ] **Step 3: Implement reconciliation**

Process `PENDING`, `ERROR` and `PENDING_DELETE` subscriptions in bounded batches through `reconcileSubscription`. Update per-component status/error/time. In `syncFromRemna`, resolve UUIDs against `RemnawaveComponent` before any Client lookup/create; unknown UUID handling remains an explicit admin import flow, never an automatic Client clone.

- [ ] **Step 4: Run all backend component tests and build**

Run: `cd backend && npx tsx --test src/modules/subscription/*.test.ts && npm run build`
Expected: all component suites pass and build exits 0.

- [ ] **Step 5: Commit Phase 3**

```bash
git add backend/src/modules/tariff/tariff-activation.service.ts backend/src/modules/gift/gift.service.ts backend/src/modules/payment/auto-renew.cron.ts backend/src/modules/client/client.routes.ts backend/src/modules/admin/admin.routes.ts backend/src/modules/bot-admin/bot-admin.routes.ts backend/src/modules/sync/sync.service.ts backend/src/modules/notification/telegram-notify.service.ts backend/src/modules/diagnostics/cron-registry.ts backend/src/modules/subscription/subscription-lifecycle.test.ts backend/src/modules/subscription/subscription-reconciliation.test.ts
git commit -m "feat: manage composite subscription lifecycle"
```

**Phase gate:** use a staging client with subscriptions 0 and 1; revoke 0, verify all its components are revoked/deleted, subscription 1 survives, and both Telegram notifications arrive. Stop for user approval.

## Phase 4 — Complete Admin UI and API Contract

### Task 6: Publish one typed logical-subscription contract

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/admin/client-subscriptions-tab.tsx`
- Modify: `frontend/src/pages/clients.tsx`
- Create: `frontend/src/lib/composite-subscription-contract.test.ts`

- [ ] **Step 1: Write failing API contract tests**

```ts
test("logical subscription serializes a public URL but no upstream URL", () => {
  const dto = toLogicalSubscriptionDto(fixture());
  assert.match(dto.subscriptionUrl, /\/api\/sub\//);
  assert.equal("upstreamUrl" in dto.components[0], false);
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd frontend && npx tsx --test src/lib/composite-subscription-contract.test.ts`
Expected: FAIL until the client contract exists.

- [ ] **Step 3: Replace root/secondary frontend types**

Define `LogicalSubscriptionDto` and `RemnawaveComponentDto`; change list, detail, extend, device and reissue calls to `subscriptionId`. Keep compatibility parsing only at the API boundary, never in components.

- [ ] **Step 4: Run contract test and frontend build**

Run: `cd frontend && npx tsx --test src/lib/composite-subscription-contract.test.ts && npm run build`
Expected: test passes and build exits 0.

### Task 7: Rebuild admin subscription controls around the logical model

**Files:**
- Modify: `frontend/src/components/admin/subscription-remna-panel.tsx`
- Modify: `frontend/src/components/admin/client-subscriptions-tab.tsx`
- Modify: `frontend/src/pages/admin-secondary-subscriptions.tsx`

- [ ] **Step 1: Add a failing focused component test or assert-based fixture**

```ts
assert.equal(componentActions({ required: true }).includes("delete"), false);
assert.equal(componentActions({ required: false }).includes("delete"), true);
```

- [ ] **Step 2: Implement the subscription card and component table**

Render logical index, public URL with copy/reissue, lifecycle/sync status and aggregate statistics. Render each component’s key, admin name, UUID, squads, quota, status and last error. Provide subscription actions (grant/extend/revoke/disable/enable/reissue/reconcile) and component actions (add/edit/delete/disable/enable/reset traffic/retry). Require confirmation before revoke/delete; show per-component result rather than a generic success toast.

- [ ] **Step 3: Remove misleading legacy actions**

Remove UI labels and callbacks that call `remna/revoke-subscription` as a one-UUID operation. Rename only the new full logical action to «Отозвать подписку»; preserve a distinct «Перевыпустить публичную ссылку» action.

- [ ] **Step 4: Build the frontend**

Run: `cd frontend && npm run build`
Expected: TypeScript and Vite exit 0.

- [ ] **Step 5: Commit Phase 4**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/composite-subscription-contract.test.ts frontend/src/components/admin frontend/src/pages/clients.tsx frontend/src/pages/admin-secondary-subscriptions.tsx
git commit -m "feat: manage composite subscriptions in admin UI"
```

**Phase gate:** manually exercise every subscription and component button in the admin UI against staging, then stop for user approval.

## Phase 5 — Cabinet and Telegram Bot Adaptation

### Task 8: Convert the cabinet to logical subscriptions

**Files:**
- Modify: `frontend/src/pages/cabinet/client-dashboard.tsx`
- Modify: `frontend/src/pages/cabinet/client-profile.tsx`
- Modify: `frontend/src/pages/cabinet/client-subscribe.tsx`
- Modify: `frontend/src/components/payment/extend-subscription-dialog.tsx`
- Modify: `frontend/src/pages/cabinet/client-gifts.tsx`

- [ ] **Step 1: Add a failing UI-data fixture**

```ts
assert.equal(subscriptionCard(fixture()).url, "https://bot.lazeika.xyz/api/sub/stable-token");
assert.equal(subscriptionCard(fixture()).technicalUuidVisible, false);
```

- [ ] **Step 2: Replace all visible technical URLs and type branches**

Render one card per logical subscription/index. Route extension, device removal, auto-renew, gifts and payment selection through `subscriptionId`. Do not show root/secondary labels or `remnawaveUuid`.

- [ ] **Step 3: Build the frontend**

Run: `cd frontend && npm run build`
Expected: build exits 0.

### Task 9: Convert bot callbacks, subscription text and revoke notices

**Files:**
- Modify: `bot/src/api.ts`
- Modify: `bot/src/index.ts`
- Modify: `bot/src/keyboard.ts`
- Modify: `bot/src/keyboard.test.ts`

- [ ] **Step 1: Write failing callback and message tests**

```ts
test("subscription callback uses logical subscription id", () => {
  assert.equal(subscriptionCallback("sub-0"), "sub:sub-0");
});

test("subscription text includes public URL and omits component UUID", () => {
  assert.match(renderSubscription(fixture()), /bot\.lazeika\.xyz\/api\/sub/);
  assert.doesNotMatch(renderSubscription(fixture()), /uuid-main/);
});
```

- [ ] **Step 2: Run bot tests to verify failure**

Run: `cd bot && npm test`
Expected: FAIL until callbacks/text use the logical contract.

- [ ] **Step 3: Implement bot logical-subscription actions and notification copy**

Use `subscriptionId` in all callback data and API calls, preserve subscription indexes in labels, show public URL only, and add the completed-revoke notification message sent by backend notification service. Keep existing bot menus and payment flows intact.

- [ ] **Step 4: Run bot tests and build**

Run: `cd bot && npm test && npm run build`
Expected: all tests pass and build exits 0.

- [ ] **Step 5: Commit Phase 5**

```bash
git add frontend/src/pages/cabinet frontend/src/components/payment/extend-subscription-dialog.tsx bot/src/api.ts bot/src/index.ts bot/src/keyboard.ts bot/src/keyboard.test.ts
git commit -m "feat: expose composite subscriptions to users"
```

**Phase gate:** run a Telegram staging smoke test: view URL, extend subscription, revoke another subscription from admin, verify user notification and notification-channel event; stop for user approval.

## Phase 6 — Full Regression, Cleanup and Deployment Readiness

### Task 10: Execute compatibility, failure and UI regression checks

**Files:**
- Modify only when an observed failing regression requires the smallest root-cause fix.
- Create: `docs/composite-subscriptions-release-checklist.md`

- [ ] **Step 1: Perform database compatibility audit**

Run the same five migration queries from Phase 1 against staging and verify: no orphan components, exactly one required component per subscription, legacy UUID equals required component UUID, every active logical subscription has a token, and every token resolves to its original logical subscription.

- [ ] **Step 2: Exercise end-to-end scenarios**

Verify: existing main-only subscription; main + whitelist subscription; user with indexes 0 and 1; optional component outage; mandatory component outage; payment; gift; trial conversion; auto-renew; manual component add/edit/delete; disable/enable; public URL reissue; full revoke; retry of failed revoke; audit/Telegram messages.

- [ ] **Step 3: Run all build/test commands from a clean dependency state**

Run:

```bash
cd backend && npm run db:generate && npm run build
cd ../frontend && npm run build
cd ../bot && npm test && npm run build
```

Expected: every command exits 0.

- [ ] **Step 4: Remove only obsolete compatibility UI paths proven unused**

Delete direct root/secondary UI branches and single-UUID revoke controls after the compatibility audit. Keep database legacy read fallback until a separately approved removal migration.

- [ ] **Step 5: Write and verify release checklist**

Record exact migration, backup, health-check, rollback and smoke-test commands. Require a fresh backup and successful staging checks before any SSH deployment.

- [ ] **Step 6: Commit Phase 6**

```bash
git add docs/composite-subscriptions-release-checklist.md
git commit -m "refactor: complete composite subscription migration"
```

**Final gate:** present verification evidence and deployment checklist. Do not connect to or modify SSH bot until the user explicitly authorizes deployment.

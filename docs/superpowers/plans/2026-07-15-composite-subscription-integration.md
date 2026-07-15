# Composite Subscription Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make trial configuration and every administrative subscription action operate on the logical subscription and all of its Remnawave components.

**Architecture:** Reuse `TrialRemnawaveComponent`, `RemnawaveComponent`, and `subscription-components.service.ts`. Trial templates are independent snapshots; logical actions fan out through the component service; component-specific fields target one component; public URLs always use the existing canonical URL builder.

**Tech Stack:** TypeScript, Express, Prisma/PostgreSQL, React/Vite, Node test runner (`tsx --test`), Zod.

## Global Constraints

- Do not hardcode `bot.lazeika.xyz`; use `publicAppUrl` with request-origin fallback.
- Preserve `Subscription.remnawaveUuid` and `Client.remnawaveUuid` only as mirrors of the required component.
- Runtime business logic must not branch on `whitelist`; that key is allowed only in the one-time data migration.
- Exactly one enabled trial component is required; component keys and merge order are unique.
- Required-component failures fail the request; optional-component failures return degraded state and schedule reconciliation.
- No new dependencies or parallel service layer.

---

### Task 1: Trial snapshots and backfill

**Files:**
- Create: `backend/prisma/migrations/20260715120000_trial_component_snapshots/migration.sql`
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Modify: `backend/src/scripts/backfill-composite-subscriptions.ts`
- Test: `backend/src/modules/subscription/trial-components.test.ts`

**Interfaces:**
- Consumes: existing `remnawaveComponentsSchema` and Prisma component relations.
- Produces: `copyTariffComponentsForTrial(tariffComponents)` returning component create inputs; POST/PATCH `/admin/trials` always persist an independent snapshot.

- [ ] **Step 1: Write failing tests for clone and migration rules**

```ts
test("trial copies tariff components without sharing mutable objects", () => {
  const source = [component("primary", true, null), component("whitelist", false, 20 * GiB)];
  const copy = copyTariffComponentsForTrial(source);
  copy[1].trafficLimitBytes = 5 * GiB;
  assert.equal(source[1].trafficLimitBytes, 20 * GiB);
});

test("backfill SQL applies 5 GiB only to copied whitelist snapshots", () => {
  assert.match(sql, /key\s*=\s*'whitelist'/);
  assert.match(sql, /5368709120/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd backend && npx tsx --test src/modules/subscription/trial-components.test.ts`  
Expected: FAIL because `copyTariffComponentsForTrial` and the migration do not exist.

- [ ] **Step 3: Add the minimal clone helper and use it in trial create/update**

```ts
export function copyTariffComponentsForTrial(components: ComponentInput[]): ComponentInput[] {
  return components.map(({ id: _id, ...component }) => ({
    ...component,
    internalSquadUuids: [...component.internalSquadUuids],
  }));
}
```

When POST receives a tariff and no component payload, load ordered enabled tariff components and create the copy. When PATCH changes `tariffId` without a component payload, replace the trial snapshot with a fresh copy. An explicit component payload always wins.

- [ ] **Step 4: Add idempotent SQL/backfill**

```sql
INSERT INTO trial_remnawave_components (...)
SELECT ... FROM trials t
JOIN tariff_remnawave_components c ON c.tariff_id = t.tariff_id
WHERE NOT EXISTS (SELECT 1 FROM trial_remnawave_components x WHERE x.trial_id = t.id);

UPDATE trial_remnawave_components c
SET traffic_limit_bytes = 5368709120
WHERE c.key = 'whitelist' AND c.trial_id IN (...backfilled trial ids...);
```

Use `ON CONFLICT (trial_id, key) DO NOTHING`; never overwrite pre-existing snapshots.

- [ ] **Step 5: Run focused tests and backend build**

Run: `cd backend && npx tsx --test src/modules/subscription/trial-components.test.ts && npm run build`  
Expected: PASS and TypeScript exit 0.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/migrations/20260715120000_trial_component_snapshots backend/src/modules/admin/admin.routes.ts backend/src/scripts/backfill-composite-subscriptions.ts backend/src/modules/subscription/trial-components.test.ts
git commit -m "feat(trials): snapshot tariff subscription components"
```

### Task 2: Trial activation uses trial templates

**Files:**
- Modify: `backend/src/modules/subscription/subscription-components.service.ts`
- Modify: `backend/src/modules/client/client.routes.ts`
- Test: `backend/src/modules/subscription/subscription-components.service.test.ts`

**Interfaces:**
- Consumes: trial snapshot from Task 1.
- Produces: exported pure `templatesForSubscription()` preferring trial components over tariff components; activation synchronizes after `trialId` is stored.

- [ ] **Step 1: Write failing tests for template precedence**

```ts
test("trial snapshot overrides tariff components", () => {
  const templates = templatesForSubscription({
    tariff: { remnawaveComponents: [component("whitelist", false, 20 * GiB)] },
    trial: { trafficLimitBytes: null, remnawaveComponents: [component("primary", true, null), component("whitelist", false, 5 * GiB)] },
  });
  assert.equal(templates.find((x) => x.key === "primary")?.trafficLimitBytes, null);
  assert.equal(templates.find((x) => x.key === "whitelist")?.trafficLimitBytes, 5n * 1024n ** 3n);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `cd backend && npx tsx --test src/modules/subscription/subscription-components.service.test.ts`  
Expected: FAIL because tariff templates currently take precedence.

- [ ] **Step 3: Reverse precedence and synchronize after linking trial**

```ts
const configured = subscription.trial?.remnawaveComponents.length
  ? subscription.trial.remnawaveComponents
  : subscription.tariff?.remnawaveComponents ?? [];
```

After `prisma.subscription.update({ data: { trialId } })`, call
`synchronizeSubscriptionComponents(subscriptionId)` and return an error only for
`requiredFailure`; optional failures remain pending.

- [ ] **Step 4: Run focused tests and backend build**

Run: `cd backend && npx tsx --test src/modules/subscription/subscription-components.service.test.ts && npm run build`  
Expected: PASS and TypeScript exit 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/subscription/subscription-components.service.ts backend/src/modules/client/client.routes.ts backend/src/modules/subscription/subscription-components.service.test.ts
git commit -m "fix(trials): materialize trial component overrides"
```

### Task 3: Component-aware admin subscription API

**Files:**
- Modify: `backend/src/modules/subscription/subscription-components.service.ts`
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Test: `backend/src/modules/subscription/subscription-components.service.test.ts`

**Interfaces:**
- Produces: `getSubscriptionComponentTargets(subscriptionId)`, `getSubscriptionComponentState(subscriptionId)`, and existing `runSubscriptionComponentOperation()` as the only fan-out mechanism.
- Admin GET returns `{ subscriptionUrl, primary, components, degraded }` while retaining primary fields for UI compatibility.

- [ ] **Step 1: Write failing fan-out and aggregation tests**

```ts
test("logical action visits required and optional components", async () => {
  const visited: string[] = [];
  const result = await runComponentOperations(twoComponents, async (x) => visited.push(x.key));
  assert.deepEqual(visited.sort(), ["primary", "whitelist"]);
  assert.equal(result.requiredFailure, false);
});

test("component patch changes only the selected snapshot", () => {
  assert.deepEqual(componentPatch("whitelist", { trafficLimitBytes: 5 * GiB }).where,
    { subscriptionId_key: { subscriptionId: "sub", key: "whitelist" } });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `cd backend && npx tsx --test src/modules/subscription/subscription-components.service.test.ts`  
Expected: FAIL for the new component-state helpers.

- [ ] **Step 3: Route logical and component operations correctly**

Implement these rules in the existing routes:

```ts
// whole subscription
await runSubscriptionComponentOperation(subId, ({ remnawaveUuid }) => action(remnawaveUuid));

// one component
await prisma.remnawaveComponent.update({
  where: { subscriptionId_key: { subscriptionId: subId, key: componentKey } },
  data: snapshotPatch,
});
await synchronizeSubscriptionComponents(subId);
```

Enable/disable/revoke/reset fan out. Expiry and HWID update DB then synchronize.
Traffic/Squad/reset mode require `componentKey`. Devices and usage aggregate all
components. HWID deletion fans out to every component containing the device.
Unlink clears every component UUID plus both legacy mirrors in one transaction.

- [ ] **Step 4: Preserve degraded errors in HTTP responses**

```ts
return res.status(result.requiredFailure ? 502 : 200).json({
  ok: !result.requiredFailure,
  degraded: result.failures.length > 0,
  failures: result.failures,
});
```

- [ ] **Step 5: Run subscription tests and backend build**

Run: `cd backend && npx tsx --test src/modules/subscription/*.test.ts && npm run build`  
Expected: all subscription tests PASS and TypeScript exit 0.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/subscription/subscription-components.service.ts backend/src/modules/admin/admin.routes.ts backend/src/modules/subscription/subscription-components.service.test.ts
git commit -m "fix(admin): apply subscription actions to all components"
```

### Task 4: Client editor and trial component UI

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/pages/trials.tsx`
- Modify: `frontend/src/components/admin/subscription-remna-panel.tsx`
- Test: backend API contract tests in `backend/src/modules/subscription/subscription-components.service.test.ts`

**Interfaces:**
- Consumes: Task 3 admin DTO and component-key routes.
- Produces: trial component editor and component selector in `Клиенты → Редактировать клиента → Подписки`.

- [ ] **Step 1: Extend frontend API types**

```ts
export interface AdminSubscriptionComponent {
  key: string;
  adminName: string;
  required: boolean;
  trafficLimitBytes: number | null;
  trafficResetMode: TrafficResetMode;
  activeInternalSquads: string[];
  lastKnownStatus: string | null;
  error?: string;
}
```

Add optional `componentKey` to component PATCH/Squad methods and type the logical
response. Do not expose or copy upstream subscription URLs.

- [ ] **Step 2: Reuse the tariff component shape in the trial form**

Store `remnawaveComponents` in `FlatTariff`. On tariff selection clone the list
with `.map(component => ({ ...component, internalSquadUuids: [...component.internalSquadUuids] }))`.
Render the existing fields: name/key, required/enabled, order, Squad, GB limit,
reset mode, and quota display. Send the list in `CreateTrialPayload`.

- [ ] **Step 3: Make the client subscription panel component-aware**

Render a component selector above Overview/Squads. Component-specific edits send
the selected key. Whole-subscription action buttons stay single-click fan-out
actions. Show `failures.map(({ key, error }) => `${key}: ${error}`)` when degraded.
Copy only `subscriptionUrl` (`/api/sub/:token`).

- [ ] **Step 4: Build frontend**

Run: `cd frontend && npm run build`  
Expected: TypeScript and Vite exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/trials.tsx frontend/src/components/admin/subscription-remna-panel.tsx
git commit -m "feat(admin): manage trial and client subscription components"
```

### Task 5: Legacy adapters and canonical URL audit

**Files:**
- Modify: `backend/src/modules/client/client-bulk-ops.service.ts`
- Modify: `backend/src/modules/bot-admin/bot-admin.routes.ts`
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Modify: `backend/src/modules/gift/gift.service.ts`
- Modify: `backend/src/modules/notification/telegram-notify.service.ts`
- Modify: `backend/src/modules/subscription/subscription.helpers.ts`
- Test: `backend/src/modules/subscription/subscription-components.test.ts`

**Interfaces:**
- Consumes: component targets from Task 3 and `buildPublicSubscriptionUrl(baseUrl, token)`.
- Produces: legacy client-level routes as adapters over logical subscriptions; every exposed link is canonical.

- [ ] **Step 1: Add a failing URL contract test**

```ts
test("changing public base changes every canonical URL without changing token", () => {
  assert.equal(buildPublicSubscriptionUrl("https://bot.lazeika.xyz", "same"), "https://bot.lazeika.xyz/api/sub/same");
  assert.equal(buildPublicSubscriptionUrl("https://new.example", "same"), "https://new.example/api/sub/same");
});
```

- [ ] **Step 2: Audit direct legacy operations**

Run: `rg -n 'remna(Get|Update|Enable|Disable|Reset|Revoke).*\(.*remnawaveUuid|Client\.remnawaveUuid|Subscription\.remnawaveUuid' backend/src/modules`  
Expected: list every direct operation; classify mirrors/read-only diagnostics versus subscription mutations.

- [ ] **Step 3: Convert mutation paths to adapters**

Client-level routes enumerate the client's logical subscriptions and call Task 3
helpers. Bulk and bot-admin paths call the same helpers. Keep legacy UUID reads
only for fallback/mirror behavior and document them inline.

- [ ] **Step 4: Centralize public URL construction**

Every gift, notification, client, bot, and admin DTO calls
`buildPublicSubscriptionUrl(config.publicAppUrl || requestOrigin, token)`. Remove
fallbacks that return upstream Remnawave subscription URLs to end users.

- [ ] **Step 5: Run backend tests/build and repeat audit**

Run: `cd backend && npm test && npm run build`  
Expected: all tests PASS and TypeScript exit 0. Repeat the `rg` command; remaining
matches must be component-service transport or documented legacy mirrors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/client/client-bulk-ops.service.ts backend/src/modules/bot-admin/bot-admin.routes.ts backend/src/modules/admin/admin.routes.ts backend/src/modules/gift/gift.service.ts backend/src/modules/notification/telegram-notify.service.ts backend/src/modules/subscription/subscription.helpers.ts backend/src/modules/subscription/subscription-components.test.ts
git commit -m "fix(subscription): route legacy operations through components"
```

### Task 6: Full verification

**Files:**
- Verify only; update implementation files only if a check exposes a defect.

- [ ] **Step 1: Apply schema generation check**

Run: `cd backend && npx prisma generate && npm run build`  
Expected: Prisma client generation and TypeScript build exit 0.

- [ ] **Step 2: Run the complete backend suite**

Run: `cd backend && npm test`  
Expected: 0 failed tests.

- [ ] **Step 3: Build the frontend**

Run: `cd frontend && npm run build`  
Expected: TypeScript and Vite exit 0.

- [ ] **Step 4: Inspect final diff and migration safety**

Run: `git diff --check HEAD~5..HEAD && git status --short`  
Expected: no whitespace errors and no uncommitted implementation files.

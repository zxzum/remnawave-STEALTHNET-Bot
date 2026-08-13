# Admin Subscription Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-policy admin preview/apply flow for tariff conversion, route admin grant/trial conversion through it, and show the result in the admin subscription panel without changing existing Remnawave identifiers or links.

**Architecture:** Keep the adapter policy in `admin.routes.ts`, reusing the existing `selectCanonicalSubscription` and `quoteConvertedDays` functions. Preview and apply call the same policy builder; apply compares a deterministic source revision before invoking `extendSecondarySubscription` with `convertMode: true`, then records `logAdmin`.

**Tech Stack:** TypeScript, Express, Zod, Prisma, existing Remnawave client, React, existing `api.ts` request helper, Node `node:test`, npm/tsc/Vite.

## Global Constraints

- All branches start from commit `4b6e759`.
- Existing `remnawaveUuid`, short UUID, and user link never change; only explicit reissue may change a link.
- `multiSubscriptionsEnabled=false` means one subscription; `true` permits multiple subscriptions.
- Do not add an owner-only `UNIQUE` database constraint.
- Write the failing test first, verify RED, then write the minimum GREEN implementation.
- Do not run production cleanup with `--apply`.
- Run shell commands through `rtk`.
- Product identity is **Лазейка ВПН**; keep existing technical compatibility names.

## Files

- Modify `backend/src/modules/admin/client-admin-consistency.contract.test.ts`: route and shared-policy contract tests.
- Modify `backend/src/modules/admin/admin.routes.ts`: policy, preview/apply, and grant/trial delegation.
- Modify `frontend/src/lib/api.ts`: typed admin preview/apply helpers.
- Modify `frontend/src/components/admin/subscription-remna-panel.tsx`: preview result and apply action.
- No schema/migration changes: existing `Subscription` and `AdminEvent` fields cover the work.

---

### Task 1: Add the RED contract for the shared admin conversion policy

**Files:**
- Modify: `backend/src/modules/admin/client-admin-consistency.contract.test.ts`

**Interfaces:**
- Require `buildAdminSubscriptionConversionPolicy` in `admin.routes.ts`.
- Require body fields `targetTariffId`, `priceOptionId`, `customDurationDays`, `subscriptionId`, `sourceRevision`, and `note`.
- Require preview/apply routes at `/clients/:id/subscription-conversion/{preview|apply}`.
- Require `convertMode: true`, `logAdmin(req, "subscription.convert_admin" ...)`, and no replacement UUID/link writes.

- [ ] **Step 1: Write the failing tests**

Append to the existing contract test:

```ts
test("admin conversion exposes one policy for preview and apply", async () => {
  const source = await readFile(adminUrl, "utf8");
  assert.match(source, /function buildAdminSubscriptionConversionPolicy/);
  assert.match(source, /adminRouter\\.post\\("\\/clients\\/\\:id\\/subscription-conversion\\/preview"/);
  assert.match(source, /adminRouter\\.post\\("\\/clients\\/\\:id\\/subscription-conversion\\/apply"/);
  assert.match(source, /sourceRevision/);
  assert.match(source, /status\\(409\\)/);
  assert.match(source, /logAdmin\\(req, "subscription\\.convert_admin"/);
});

test("admin conversion uses canonical single mode and explicit multi mode", async () => {
  const source = await readFile(adminUrl, "utf8");
  const conversion = source.slice(source.indexOf("function buildAdminSubscriptionConversionPolicy"), source.indexOf("const attachRemnaSchema"));
  assert.match(conversion, /selectCanonicalSubscription/);
  assert.match(conversion, /multiSubscriptionsEnabled/);
  assert.match(conversion, /subscriptionId/);
  assert.match(conversion, /expireAt/);
  assert.match(conversion, /subscriptionIndex/);
});

test("admin conversion delegates conversion and exposes downgrade day policy", async () => {
  const source = await readFile(adminUrl, "utf8");
  const conversion = source.slice(source.indexOf("function buildAdminSubscriptionConversionPolicy"), source.indexOf("const attachRemnaSchema"));
  assert.match(conversion, /extendSecondarySubscription[\\s\\S]*convertMode:\\s*true/);
  assert.doesNotMatch(conversion, /createAdditionalSubscription/);
  assert.doesNotMatch(conversion, /remnawaveUuid\\s*:/);
  assert.doesNotMatch(conversion, /remnawaveShortUuid\\s*:/);
  assert.match(conversion, /quoteConvertedDays|computeConvertedDays/);
  assert.match(conversion, /commissionPercent|commission/);
  assert.match(conversion, /remainingDays/);
  assert.match(conversion, /convertedDays/);
  assert.match(conversion, /totalDays/);
});
```

- [ ] **Step 2: Run RED**

```bash
cd backend
rtk npx tsx --test src/modules/admin/client-admin-consistency.contract.test.ts
```

Expected: FAIL because the new policy and routes are absent.

- [ ] **Step 3: Commit the RED test**

```bash
rtk git add backend/src/modules/admin/client-admin-consistency.contract.test.ts
rtk git commit -m "test: specify admin subscription conversion contract"
```

---

### Task 2: Implement the shared policy and preview/apply routes

**Files:**
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Test: `backend/src/modules/admin/client-admin-consistency.contract.test.ts`

**Interfaces:**
- Define `adminSubscriptionConversionSchema`.
- Define `buildAdminSubscriptionConversionPolicy(clientId, input, options?)` returning source/target tariff data, `remainingDays`, `convertedDays`, `totalDays`, `commissionPercent`, `direction`, and `sourceRevision`.
- Preview and apply use the same builder; apply requires `sourceRevision` and returns 409 on mismatch.

- [ ] **Step 1: Add RED assertions for output fields**

Require `currentTariff`, `targetTariff`, `remainingDays`, `convertedDays`, `totalDays`, `commissionPercent`, and `sourceRevision` in the conversion route slice, then rerun the contract test and confirm it fails.

- [ ] **Step 2: Implement the minimum policy**

Import the existing `selectCanonicalSubscription` and `quoteConvertedDays`. Load the client, active owned subscriptions, target tariff, and selected price option. In single mode select the canonical active row; in multi mode require `input.subscriptionId` and verify ownership. Compute:

```ts
const remainingDays = Math.max(0, Math.floor(((source.expireAt?.getTime() ?? now.getTime()) - now.getTime()) / 86_400_000));
const targetDays = customDurationDays ?? selectedOption?.durationDays ?? targetTariff.durationDays;
const targetPrice = selectedOption?.price ?? targetTariff.price;
const quote = quoteConvertedDays({
  remainingDays,
  oldPricePerDay: source.currentPricePerDay,
  newPricePerDay: targetDays > 0 ? targetPrice / targetDays : 0,
  sameTariff: source.tariffId === targetTariff.id && source.trialId == null,
  isTrial: source.trialId != null,
});
```

Use `quote.commissionPercent` directly, so the existing policy shows five percent only for downgrade. Build `sourceRevision` from source ID, update timestamp, tariff ID, expiry, and Remnawave UUID with `JSON.stringify`; no dependency is needed.

- [ ] **Step 3: Implement preview and apply**

Add both routes before the existing grant routes. Preview returns the policy. Apply requires the revision, rebuilds the policy, responds with 409 without mutation when revisions differ, then calls `extendSecondarySubscription` with the full target tariff input and `convertMode: true`, locks the trial, calls `logAdmin(req, "subscription.convert_admin", ...)`, and returns the policy plus activation status. Do not create a replacement subscription or write identifier/link fields.

- [ ] **Step 4: Run GREEN and commit**

```bash
cd backend
rtk npx tsx --test src/modules/admin/client-admin-consistency.contract.test.ts
rtk git add backend/src/modules/admin/admin.routes.ts backend/src/modules/admin/client-admin-consistency.contract.test.ts
rtk git commit -m "feat: add admin subscription conversion preview"
```

---

### Task 3: Route admin grant and trial conversion through the shared apply path

**Files:**
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Test: `backend/src/modules/admin/client-admin-consistency.contract.test.ts`

**Interfaces:**
- Keep public `grant-tariff`, `grant-extend`, and `convert-trial` request/response shapes.
- Add one local `applyAdminSubscriptionConversion` helper that receives the built policy, request, client ID, note, and target tariff input, calls the shared activation service, locks trial state, and audits.
- In single mode, `grant-tariff` uses the canonical active source when one exists; creation remains only for the no-source case or explicit multi-mode behavior.
- In multi mode, explicit `subscriptionId` remains authoritative.

- [ ] **Step 1: Write RED assertions**

For each of the three route slices, assert `/buildAdminSubscriptionConversionPolicy|applyAdminSubscriptionConversion/`; for trial conversion assert `convertMode.*true`. Run the contract test and confirm failure.

- [ ] **Step 2: Implement the minimum delegation**

Preserve existing payment, notification, entitlement validation, and trial-lock behavior. Replace duplicated mutation logic with the helper where a source subscription exists. Do not alter the existing UUID, short UUID, or URL fields.

- [ ] **Step 3: Run GREEN and commit**

```bash
cd backend
rtk npx tsx --test src/modules/admin/client-admin-consistency.contract.test.ts
rtk git add backend/src/modules/admin/admin.routes.ts backend/src/modules/admin/client-admin-consistency.contract.test.ts
rtk git commit -m "feat: route admin grants through conversion policy"
```

---

### Task 4: Add typed frontend preview/apply helpers

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Add exported `AdminSubscriptionConversionRequest` and `AdminSubscriptionConversionPreview` types with source/target tariff, day breakdown, commission, direction, and `sourceRevision`.
- Add `api.previewAdminSubscriptionConversion(token, clientId, payload)` and `api.applyAdminSubscriptionConversion(token, clientId, payload)`, POSTing to the matching admin routes.

- [ ] **Step 1: Add the typed API methods and verify their use**

Use the existing `request` helper and keep payload fields unchanged. The panel in Task 5 will consume these exact method names and types.

- [ ] **Step 2: Run the frontend build**

```bash
cd frontend
rtk npm run build
```

Expected: PASS after the methods compile.

- [ ] **Step 3: Commit**

```bash
rtk git add frontend/src/lib/api.ts
rtk git commit -m "feat: add admin conversion API helpers"
```

---

### Task 5: Add preview/apply UI to the admin subscription panel

**Files:**
- Modify: `frontend/src/components/admin/subscription-remna-panel.tsx`

**Interfaces:**
- Consume the selected `subscription.id`, `subscription.isTrial`, and `tariffs`.
- Send the concrete subscription ID; backend canonical selection remains authoritative in single mode.
- Render current/target tariff, remaining/converted/total days, and commission only when `commissionPercent === 5`.
- Send the preview `sourceRevision` on apply; clear the preview and request refresh on HTTP 409.

- [ ] **Step 1: Add conversion state and preview handler**

Use existing `useState`, `api`, `Button`, `Input`, and `select` primitives; no new component or dependency.

- [ ] **Step 2: Render the compact conversion block**

Place it in the Actions tab next to trial conversion. The preview button sends `targetTariffId`, `priceOptionId`, and `subscriptionId`; show both tariff names and the three day values. The apply button confirms once, sends the same selection plus `sourceRevision`, refreshes Remna/client state, and handles stale preview.

- [ ] **Step 3: Run the frontend build and commit**

```bash
cd frontend
rtk npm run build
rtk git add frontend/src/components/admin/subscription-remna-panel.tsx
rtk git commit -m "feat: show admin conversion preview"
```

---

### Task 6: Full verification and handoff

**Files:**
- No new files.

- [ ] **Step 1: Run the requested checks**

```bash
cd backend
rtk npx tsx --test src/modules/admin/client-admin-consistency.contract.test.ts
rtk npx tsc --noEmit --pretty false
cd ../frontend
rtk npm run build
```

- [ ] **Step 2: Review the diff**

```bash
rtk git status --short --branch
rtk git diff --check
rtk git diff --stat 4b6e759..HEAD
```

Confirm changes are limited to the owned backend/frontend files plus the committed spec and plan. No schema/migration file, owner-only unique constraint, production cleanup, or reissue path is added.

- [ ] **Step 3: Commit any final correction**

```bash
rtk git add backend/src/modules/admin/admin.routes.ts backend/src/modules/admin/client-admin-consistency.contract.test.ts frontend/src/components/admin/subscription-remna-panel.tsx frontend/src/lib/api.ts
rtk git commit -m "chore: verify admin subscription conversion"
```

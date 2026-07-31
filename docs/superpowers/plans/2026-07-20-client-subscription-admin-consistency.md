# Client And Tariff Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct empty-account admin rendering, multi-subscription filtering/activity, tariff entitlement display, quota propagation, and the optional onboarding 2FA step.

**Architecture:** Keep `Client` creation independent of Remnawave. Enrich the existing admin clients endpoint from subscription relations, keep tariff quota propagation inside the existing tariff transaction, and reuse the existing system-settings pipeline for one boolean 2FA flag.

**Tech Stack:** Express, Prisma/PostgreSQL, React/Vite, TypeScript, Node test runner.

## Global Constraints

- Do not create placeholder Remnawave users or subscriptions.
- Preserve existing user fixes and unrelated dirty-worktree changes.
- Preserve quota usage and period progress when limits change.
- Use direct Remnawave subscription URLs only.

---

### Task 1: Empty Client And Subscription-Aware Admin List

**Files:**
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/pages/clients.tsx`
- Test: `backend/src/modules/admin/admin-client-list.contract.test.ts`

- [ ] Write a failing contract test asserting the clients route accepts `subscription=any|active`, selects subscription summaries, and no longer relies only on `Client.remnawaveUuid`.
- [ ] Run `cd backend && npm test -- src/modules/admin/admin-client-list.contract.test.ts` and confirm failure.
- [ ] Add subscription summaries and aggregated UUID activity to the existing route; add the query parameter without adding a second endpoint.
- [ ] Always render tabs, render empty states, and format labels as username → email → `tg<id>` → ID.
- [ ] Run the focused test and `cd frontend && npm run build`.

### Task 2: Correct Tariff Entitlement Presentation

**Files:**
- Modify: `frontend/src/pages/cabinet/client-tariffs.tsx`
- Test: `frontend/src/pages/cabinet/client-tariffs.test.ts`

- [ ] Extract the smallest pure formatter for tariff entitlement labels and write failing tests for LOCAL_SQUAD and REMNAWAVE modes.
- [ ] Run the focused frontend test and confirm failure.
- [ ] Add `trafficLimitMode` to the existing tariff type, show general unlimited plus whitelist quota for LOCAL_SQUAD, and use `includedDevices`.
- [ ] Run the focused test and frontend build.

### Task 3: Preserve Usage While Propagating Tariff Quota Changes

**Files:**
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Test: `backend/src/modules/admin/tariff-quota-propagation.contract.test.ts`

- [ ] Write a failing test proving tariff PATCH updates matching quota base limits in the same transaction and does not write `usedBytes` or period fields.
- [ ] Run the focused test and confirm failure.
- [ ] Add one `squadTrafficQuota.updateMany` beside the existing tariff update, only for LOCAL_SQUAD limit changes.
- [ ] Run focused and squad-traffic tests.

### Task 4: Optional Registration 2FA Step

**Files:**
- Modify: `backend/src/modules/client/client.service.ts`
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/pages/settings.tsx`
- Modify: `frontend/src/pages/cabinet/client-onboarding.tsx`
- Test: `frontend/src/pages/cabinet/client-onboarding.test.ts`

- [ ] Write a failing test for step construction with 2FA disabled.
- [ ] Run the focused test and confirm failure.
- [ ] Add `onboarding_2fa_enabled` to the existing settings mapping, API types, settings checkbox, and onboarding step list.
- [ ] Run the focused test and frontend build.

### Task 5: Verification And Production Reconciliation

**Files:**
- Modify only deployment state and production data after backup.

- [ ] Run backend tests/build and frontend tests/build.
- [ ] Validate clients modal/list and `/cabinet/tariffs` through the Browser workflow on desktop and mobile.
- [ ] Create a fresh PostgreSQL backup on `bot`.
- [ ] Deploy the existing working tree using the project deployment script.
- [ ] Set onboarding 2FA off in production.
- [ ] Reconcile mismatched LOCAL_SQUAD `baseLimitBytes` from tariffs without modifying usage or periods.
- [ ] Verify services healthy, direct subscription URL works, quota mismatches are zero, and sampled `usedBytes` values are unchanged.

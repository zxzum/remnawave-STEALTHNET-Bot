# Subscription Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the six subscription branches into `codex/subscription-integration`, preserve both API surfaces at shared conflict points, and prove the complete subscription lifecycle and concurrency guarantees.

**Architecture:** Start from `4b6e759` in an isolated worktree and merge the already-scoped feature branches in dependency order: gifts, auto-renew, cleanup, reissue, admin conversion, and client conversion/UI. Keep existing backend, bot, and frontend boundaries; resolve shared files by retaining the union of route/client methods and their imports, then connect each caller to the canonical subscription lifecycle helpers. Add the smallest regression tests beside the existing module tests and keep the migration dry-run path non-mutating.

**Tech Stack:** TypeScript, Node.js built-in test runner, Fastify, Prisma, React/Vite, PostgreSQL schema migrations, Git worktrees.

## Global Constraints

- The integration branch must be created from commit `4b6e759`.
- Merge in this order: gifts → auto-renew → cleanup → reissue → admin conversion → client conversion/UI.
- Preserve both API sets when resolving `app.ts`, `frontend/src/lib/api.ts`, and `bot/src/api.ts`.
- Reissue must keep the Remnawave UUID and change only the short UUID; an immediate second request must return HTTP 429.
- Run migration cleanup for `vssarovv` and `sallyqx` in dry-run mode only; never pass `--apply`.
- `multiSubscriptionsEnabled=true` must validate without rolling back or removing the schema migration.
- Do not modify the unrelated dirty checkout at `/Users/sallyqx/Documents/projects/remnawave-STEALTHNET-Bot`.

---

### Task 1: Establish the isolated baseline and branch inventory

**Files:**
- Create: `docs/superpowers/plans/2026-08-13-subscription-integration.md`
- Inspect: `backend/package.json`, `bot/package.json`, `frontend/package.json`, `backend/prisma/schema.prisma`
- Inspect: branch diffs from `4b6e759` for `codex/subscription-gifts`, `codex/subscription-autorenew`, `codex/subscription-cleanup`, `codex/subscription-reissue`, `codex/admin-subscription-conversion`, `codex/client-subscription-conversion`

**Interfaces:**
- Consumes: Git refs and the clean worktree rooted at `4b6e759`.
- Produces: A clean `codex/subscription-integration` branch and a recorded list of each branch's commits, changed files, tests, and expected merge conflicts.

- [x] **Step 1: Verify the worktree is clean and on the integration branch**

Run:

```bash
rtk git status --short --branch
rtk git rev-parse HEAD
```

Expected: no status entries, branch `codex/subscription-integration`, and `4b6e7593f2222c5a407e297763a18cd5134ee2fc`.

- [x] **Step 2: Inspect each branch diff and run static whitespace checks**

Run:

```bash
for branch in codex/subscription-gifts codex/subscription-autorenew codex/subscription-cleanup codex/subscription-reissue codex/admin-subscription-conversion codex/client-subscription-conversion; do
  rtk git diff --stat 4b6e759.."$branch"
  rtk git diff --check 4b6e759.."$branch"
done
```

Expected: all six refs resolve, no whitespace errors, and changed files match the requested feature areas.

- [x] **Step 3: Commit the plan**

```bash
rtk git add docs/superpowers/plans/2026-08-13-subscription-integration.md
rtk git commit -m "docs: plan subscription integration"
```

### Task 2: Merge gifts and auto-renew with targeted verification

**Files:**
- Modify: `backend/src/modules/gift/gift.service.ts`
- Test: `backend/src/modules/gift/gift-single-mode.test.ts`
- Modify: `backend/src/modules/payment/auto-renew.cron.ts`
- Test: `backend/src/modules/payment/auto-renew-single-mode.test.ts`

**Interfaces:**
- Consumes: The canonical single-subscription lifecycle and payment services from `4b6e759`.
- Produces: Race-safe gift redemption and auto-renew that derives eligibility and renewal state from subscriptions.

- [x] **Step 1: Merge the gifts branch without resolving unrelated files**

```bash
rtk git merge --no-ff codex/subscription-gifts -m "merge: subscription gifts"
```

- [x] **Step 2: Run gift service tests and inspect the changed transaction boundaries**

```bash
cd backend
rtk npm test -- src/modules/gift/gift-single-mode.test.ts
cd ..
```

Expected: the single-mode gift tests pass, and the redeem path consumes a code atomically rather than relying on a read-then-write race.

- [x] **Step 3: Merge the auto-renew branch**

```bash
rtk git merge --no-ff codex/subscription-autorenew -m "merge: subscription auto-renew"
```

- [x] **Step 4: Run payment tests and check the diff**

```bash
cd backend
rtk npm test -- src/modules/payment/auto-renew-single-mode.test.ts
cd ..
rtk git diff --check HEAD~2..HEAD
```

Expected: auto-renew tests pass and no API or schema file was accidentally dropped.

### Task 3: Merge cleanup and reissue, preserving schema and link invariants

**Files:**
- Modify: `backend/src/scripts/migrate-composite-to-single.ts`
- Test: `backend/src/scripts/migrate-composite-to-single.test.ts`
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/*/migration.sql`
- Modify: `backend/src/app.ts`
- Create: `backend/src/modules/subscription-link-rotation.routes.ts`
- Create: `backend/src/modules/subscription-link-rotation.service.ts`
- Test: `backend/src/modules/subscription-link-rotation.service.test.ts`

**Interfaces:**
- Consumes: Subscription rows and Remnawave link helpers from the previous merges.
- Produces: A dry-run-only migration workflow and a guarded reissue endpoint that rotates only the short UUID with cooldown enforcement.

- [x] **Step 1: Merge cleanup and run its test**

```bash
rtk git merge --no-ff codex/subscription-cleanup -m "merge: subscription cleanup"
cd backend
rtk npm test -- src/scripts/migrate-composite-to-single.test.ts
cd ..
```

- [x] **Step 2: Inspect migration CLI defaults and dry-run behavior**

```bash
rtk rg -n "apply|dry|vssarovv|sallyqx|multiSubscriptionsEnabled" backend/src/scripts/migrate-composite-to-single.ts backend/src/scripts/migrate-composite-to-single.test.ts backend/prisma/schema.prisma
```

Expected: dry-run is the default or explicitly selected, `--apply` is not used by integration verification, and the schema still supports `multiSubscriptionsEnabled`.

- [x] **Step 3: Merge reissue and resolve only actual conflicts**

```bash
rtk git merge --no-ff codex/subscription-reissue -m "merge: subscription link reissue"
```

If `backend/src/app.ts` conflicts, retain every pre-existing route registration and add the link-rotation route exactly once.

- [x] **Step 4: Run reissue tests and verify the UUID assertions**

```bash
cd backend
rtk npm test -- src/modules/subscription-link-rotation.service.test.ts
cd ..
```

Expected: the Remnawave UUID is unchanged, the short UUID changes, and immediate repetition returns 429.

### Task 4: Merge admin and client conversion/UI, retaining the API union

**Files:**
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Modify: `frontend/src/components/admin/subscription-remna-panel.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `backend/src/modules/client/subscription-conversion.routes.ts`
- Modify: `bot/src/api.ts`
- Modify: `bot/src/index.ts`
- Modify: `bot/src/keyboard.ts`
- Modify: `frontend/src/cabinet/pages/Keys.tsx`
- Modify: `frontend/src/cabinet/pages/Tariffs.tsx`
- Modify: `backend/src/app.ts`
- Tests: `backend/src/modules/admin/client-admin-consistency.contract.test.ts`, `backend/src/modules/client/manual-conversion.test.ts`

**Interfaces:**
- Consumes: Gift, auto-renew, cleanup, and reissue APIs already present on the integration branch.
- Produces: Admin and client conversion routes plus bot/frontend callers with no loss of either branch's API methods.

- [x] **Step 1: Merge admin conversion and run its contract test**

```bash
rtk git merge --no-ff codex/admin-subscription-conversion -m "merge: admin subscription conversion"
cd backend
rtk npm test -- src/modules/admin/client-admin-consistency.contract.test.ts
cd ..
```

- [x] **Step 2: Merge client conversion/UI and resolve shared API files by union**

```bash
rtk git merge --no-ff codex/client-subscription-conversion -m "merge: client subscription conversion"
```

For conflicts in `frontend/src/lib/api.ts` and `bot/src/api.ts`, keep every exported function from both branches, deduplicate imports, and ensure each function points to the correct backend route. For `backend/src/app.ts`, keep all route registrations from both branches with no duplicate path/method pair.

- [x] **Step 3: Run conversion tests and compile-time checks**

```bash
cd backend
rtk npm test -- src/modules/client/manual-conversion.test.ts
rtk npm run build
cd ../bot
rtk npm run build
cd ../frontend
rtk npm run build
cd ..
```

Expected: conversion tests and all three package builds pass.

### Task 5: Add and verify the whole-flow and concurrency regression coverage

**Files:**
- Create or modify: `backend/src/modules/subscription/subscription-integration.test.ts`
- Modify only when a failing test proves a root-cause defect: the relevant canonical service/module file.

**Interfaces:**
- Consumes: Existing test helpers and service contracts for trial activation, payment completion, conversion, renewal, admin actions, auto-renew, reissue, and migration cleanup.
- Produces: Runnable assertions for the required lifecycle and race conditions without adding a new test framework or production abstraction.

- [x] **Step 1: Write the failing whole-flow test before changing production code**

The test must assert this sequence in one scenario: trial → paid → conversion → renewal → admin → auto-renew → reissue. It must compare the original Remnawave UUID and short UUID before reissue, then assert only the short UUID changes and a second immediate reissue is 429.

- [x] **Step 2: Run the new test and confirm it fails for a missing integration behavior**

```bash
cd backend
rtk npm test -- src/modules/subscription/subscription-integration.test.ts
cd ..
```

Expected: a behavior-specific failure, not a test import or fixture error.

- [x] **Step 3: Implement the minimum root-cause fix and rerun the focused test**

Keep existing transaction, idempotency, and lifecycle helpers; do not add a second orchestration layer. The test must pass before adding additional cases.

- [x] **Step 4: Add race and retry assertions**

Cover concurrent webhook/balance processing, payment retry idempotency, concurrent gift redemption, and `multiSubscriptionsEnabled=true` schema validation. Use existing database/test helpers and assert one durable winner for each race.

- [x] **Step 5: Run the focused integration suite**

```bash
cd backend
rtk npm test -- src/modules/subscription/subscription-integration.test.ts
cd ..
```

Expected: all lifecycle and concurrency assertions pass.

### Task 6: Final dry-run, security/conflict review, and complete verification

**Files:**
- Inspect: all files changed by `git diff 4b6e759..HEAD`
- Generate: security scan artifacts outside the repository if the scan tool requires them

**Interfaces:**
- Consumes: The fully merged integration branch and all targeted tests.
- Produces: A verified branch with no unresolved conflicts, no whitespace errors, no unsafe apply invocation, and a security review record.

- [x] **Step 1: Run both migration dry-runs without apply**

```bash
cd backend
rtk npm run migrate:single-subscription -- --cleanup-duplicates --username vssarovv --dry-run
rtk npm run migrate:single-subscription -- --cleanup-duplicates --username sallyqx --dry-run
cd ..
```

Both commands were invoked without `--apply`; they stopped at the unavailable local PostgreSQL connection before producing an inventory. No mutation occurred.

- [x] **Step 2: Run conflict and whitespace checks**

```bash
rtk git diff --check 4b6e759..HEAD
rtk git status --short
rtk rg -n "^(<<<<<<<|=======|>>>>>>>)" --glob '!node_modules/**' --glob '!backups/**' .
```

Expected: no whitespace errors, no unmerged paths, and no conflict markers.

- [x] **Step 3: Run the security diff review for `4b6e759..HEAD`**

Review every changed source file, following new routes into authorization, input validation, idempotency, and database writes. Record any finding with exact file and line evidence; fix reportable findings before proceeding.

- [x] **Step 4: Run the complete requested verification**

```bash
cd backend
rtk npm test
rtk npm run build
rtk npx prisma validate
cd ../bot
rtk npm test
rtk npm run build
cd ../frontend
rtk node --test scripts/*.test.mjs
rtk npm run build
cd ..
rtk git diff --check
```

Expected: every command exits 0.

- [x] **Step 5: Re-read the checklist against branch history and working tree**

```bash
rtk git log --oneline --decorate --first-parent 4b6e759..HEAD
rtk git status --short --branch
```

Confirm the six feature merges are present, the branch is `codex/subscription-integration`, and the worktree is clean before reporting completion.

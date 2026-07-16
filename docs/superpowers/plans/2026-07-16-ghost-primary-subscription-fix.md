# Ghost Primary Subscription Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a deleted primary subscription from resurfacing through a stale client-level Remnawave UUID and remove the current orphan for `@sallyqx`.

**Architecture:** Make the `Subscription(index=0)` row the sole source of primary subscription state. Clear legacy client anchors inside the shared successful revoke/delete lifecycle so every caller gets the same behavior.

**Tech Stack:** TypeScript, Node.js test runner, Prisma, Remnawave admin API, PostgreSQL.

## Global Constraints

- Client-visible subscription URLs must use `bot.lazeika.xyz/api/sub/<token>` only.
- Do not add dependencies or new service layers.
- Production cleanup must be read back after mutation.

---

### Task 1: Regression contract

**Files:**
- Create: `backend/src/modules/subscription/ghost-primary-subscription.contract.test.ts`

**Interfaces:**
- Consumes: `client.routes.ts` and `subscription-components.service.ts` source contracts.
- Produces: a regression check for no legacy fallback and primary legacy cleanup.

- [x] Write a source contract test asserting `effectiveUuid` comes only from `rootSub`, and successful primary revoke/delete clears `remnawaveUuid` plus `currentTariffId`.
- [x] Run `npm test -- --test-name-pattern='ghost primary'` and confirm it fails on the stale fallback/cleanup.

### Task 2: Minimal lifecycle fix

**Files:**
- Modify: `backend/src/modules/client/client.routes.ts`
- Modify: `backend/src/modules/subscription/subscription-components.service.ts`

**Interfaces:**
- Consumes: existing Prisma client and logical subscription lifecycle.
- Produces: primary subscription lookup without legacy fallback; legacy client reset after successful primary removal.

- [x] Remove `client.remnawaveUuid` fallback from `GET /subscription`.
- [x] After successful primary revoke/delete, clear the legacy client UUID, tariff, primary-price, and auto-renew fields.
- [x] Re-run the focused test and confirm it passes.

### Task 3: Verification and production cleanup

**Files:**
- No repository files.

**Interfaces:**
- Consumes: production client ID and orphan Remnawave UUID identified during diagnosis.
- Produces: no STEALTHNET subscriptions, no legacy client UUID/tariff, and Remnawave HTTP 404 for the orphan UUID.

- [x] Run the full backend test suite and TypeScript build.
- [x] Delete the orphan Remnawave user first; only after success clear the legacy client fields in PostgreSQL.
- [x] Read back STEALTHNET and Remnawave state and report exact results.

# Primary Trial Entry Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the surviving client subscription the persisted primary after primary deletion, preserve its Remnawave UUID during eligible trial conversion, and expose explicit trial activation on first bot and Mini App entry.

**Architecture:** Keep `Subscription.subscriptionIndex = 0` as the canonical primary, promote the lowest active owned subscription only after the old primary row is successfully removed, and synchronize the legacy `Client` anchor from the promoted row. Reuse the existing explicit trial conversion API and trial picker; only fix candidate selection and entry-point wiring so conversion updates the existing Remnawave user instead of replacing its link.

**Tech Stack:** TypeScript, Prisma, Node.js test runner, React/Vite.

## Global Constraints

- Preserve existing direct public subscription URLs and Remnawave UUIDs during conversion.
- Keep gift subscriptions out of primary promotion.
- Preserve the ghost-primary fallback behavior for clients whose index `0` is absent.
- Do not add dependencies or new services.

---

### Task 1: Lock primary selection and standalone-trial conversion behavior

**Files:**
- Create: `bot/src/subscription-access.test.ts`
- Create: `backend/src/modules/tariff/trial-conversion.test.ts`

**Interfaces:**
- Tests consume `selectPrimarySubscriptionItem`, `canExtendSubscription`, and `trialAllowsTariff` after implementation.
- Tests require primary index `0` to win over later items, fallback to remain available, and standalone trial conversion to respect allow-all, allow-list, and disabled settings.

- [x] Write failing tests for the pure selection and conversion-policy cases.
- [x] Run the two focused tests and confirm failure because the helpers do not yet exist.

### Task 2: Promote the surviving subscription after primary deletion

**Files:**
- Modify: `backend/src/modules/subscription/single-subscription-lifecycle.service.ts`

**Interfaces:**
- Consumes the existing `completeSubscriptionDeletion(subscriptionId, links)` lifecycle.
- Produces `subscriptionIndex = 0` for the lowest active non-gift replacement and synchronizes `Client.remnawaveUuid`, tariff, price, and auto-renew fields from it.

- [x] Implement the promotion inside the existing Prisma transaction after deleting the old row.
- [x] Preserve the reset-to-null behavior when no replacement exists.
- [x] Run the ghost-primary and subscription lifecycle contract tests.

### Task 3: Use primary-first access and explicit first-entry trial activation

**Files:**
- Create: `bot/src/subscription-access.ts`
- Modify: `bot/src/index.ts`
- Modify: `bot/src/api.ts`

**Interfaces:**
- `selectPrimarySubscriptionItem<T>(items, hasAccess)` returns the valid index-0 item or the first valid fallback.
- `canExtendSubscription({ tariffId, trialId })` accepts standalone trials.
- First welcome uses the existing `menu:trial` picker and says “Активировать пробный период”.

- [x] Implement the helpers and wire `firstSubscriptionAccess` to primary-first selection.
- [x] Keep legacy `welcome:try` callback handling for already-rendered keyboards.
- [x] Allow nullable `tariffId` in standalone-trial API types.
- [x] Run bot tests and TypeScript build.

### Task 4: Route every eligible trial purchase through UUID-preserving conversion

**Files:**
- Modify: `backend/src/modules/tariff/tariff-activation.service.ts`
- Modify: `frontend/src/cabinet/model.ts`
- Modify: `frontend/src/cabinet/pages/Tariffs.tsx`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- `trialAllowsTariff` is the shared policy for same-tariff, allow-list, allow-all, and disabled trial conversion.
- Conversion preview and purchase mode choose `extendsSecondarySubId` for an eligible trial; `replaceTrialSubId` remains only the fallback when conversion is not allowed.

- [x] Add eligible trial lookup to `findConvertibleSubscription` and reuse the policy in explicit conversion validation.
- [x] Map trial conversion metadata into the Cabinet model and choose an eligible trial target for the selected tariff.
- [x] Make standalone trial IDs nullable in frontend API types and include `replaceTrialSubId` in the balance request type.
- [x] Run backend tests, frontend model/script tests, and frontend build.

### Task 5: Verify the complete user paths

**Files:**
- No repository files.

**Interfaces:**
- Consumes the implemented backend, bot, and frontend behavior.
- Produces evidence that the new primary is selected, conversion keeps the same UUID/link, and activation buttons are present.

- [x] Run focused red/green tests, full backend tests, bot tests, frontend tests, and builds.
- [x] Run `git diff --check` and inspect the final diff for unrelated changes.
- [x] Commit and push only the implementation files when verification passes.

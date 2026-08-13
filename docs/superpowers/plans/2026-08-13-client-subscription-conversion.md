# Client Subscription Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a signed, expiring manual tariff-conversion flow that carries the existing client subscription onto the selected tariff without purchasing a month, then expose the flow in the Лазейка ВПН cabinet and bot while keeping all conversion arithmetic in the backend.

**Architecture:** A new authenticated client router owns quote creation and application. The quote is a JWT containing the source subscription snapshot and the backend policy result; the apply request verifies it, re-reads the source under the existing client advisory lock, and rejects a changed snapshot with HTTP 409. Remnawave is updated in place using the existing UUID, while the existing reissue endpoint remains the only operation that changes a link. The cabinet owns the interactive UI; the bot only renders backend preview/quote fields and keeps its existing reissue callback.

**Tech Stack:** TypeScript, Express, Zod, `jsonwebtoken`, Prisma, React, Vite, Telegram bot API, Node test runner.

## Global Constraints

- Start from commit `4b6e759` on branch `codex/client-subscription-conversion`.
- Preserve the existing `remnawaveUuid`, short UUID, and subscription URL during conversion; only manual reissue may change a URL.
- Respect `multiSubscriptionsEnabled`: single mode converts the canonical eligible subscription, multi mode may convert the selected subscription only when the tariff/category policy permits it.
- Reuse `quoteConvertedDays`; do not add an owner-only `UNIQUE` constraint.
- Keep quote TTL at 15 minutes and return 409 for invalid, expired, or stale quotes.
- Write tests first, run every command through `rtk`, and never run production cleanup with `--apply`.
- Touch only the owned surfaces plus the new backend route, its mount, and this plan/spec documentation.

---

## Task 1: Add the backend RED contract for manual conversion

**Files:**

- Create `backend/src/modules/client/manual-conversion.test.ts`.
- The implementation file is intentionally absent until the tests fail.

**Interfaces consumed:**

- `quoteConvertedDays` from `backend/src/modules/subscription/subscription-change.policy.ts`.
- The new route module exports `calculateManualConversionQuote`, `signManualConversionQuote`, `verifyManualConversionQuote`, and `isManualConversionQuoteStale`.

**Interfaces produced:**

- A runnable contract for arithmetic, signed-token contents/TTL, stale-snapshot detection, and UUID-preserving apply behavior.

**Steps:**

- [ ] Import `node:test`, `node:assert/strict`, and the four named route helpers.
- [ ] Add an upgrade case with `remainingDays: 11`, old daily price `10`, and target daily price `20`; assert raw `5.5`, `convertedDays: 6`, direction `upgrade`, and zero commission.
- [ ] Add the minimum-raw-day guard with one remaining day and a 10-to-20 price change; assert the quote is denied rather than silently creating a zero-day conversion.
- [ ] Add a downgrade case whose five-percent commission is applied before `floor` and assert the exact converted days.
- [ ] Add same-tariff and trial cases; assert one-to-one whole remaining days and zero commission.
- [ ] Sign a quote with subscription id, tariff/option, source expiry, source revision, and converted days; verify those claims and assert the token expiry is 15 minutes.
- [ ] Assert a changed source expiry or revision is stale, while an identical snapshot is not.
- [ ] Add an apply-facing fixture that records the Remnawave identifier before and after the operation and asserts UUID and link are identical; the test must fail until the route exports the matching helper/adapter.
- [ ] Run the RED command and record the expected module/export failure before implementing the route:

```bash
cd backend
rtk npx tsx --test src/modules/client/manual-conversion.test.ts
```

---

## Task 2: Implement the signed quote and manual conversion route

**Files:**

- Create `backend/src/modules/client/subscription-conversion.routes.ts`.
- Modify `backend/src/app.ts` to mount the new router under `/api/client/subscription-conversion`.
- Modify `backend/src/modules/client/manual-conversion.test.ts` only as needed to complete the contract from Task 1.

**Interfaces consumed:**

- `requireClientAuth` from `client.middleware.ts`.
- `env.JWT_SECRET` and the existing `jsonwebtoken` dependency.
- `quoteConvertedDays` and its `ConversionQuote` type.
- `findConvertibleSubscription`, `withClientSubscriptionLock`, `trialAllowsTariff`, and existing tariff/price-option lookup patterns.
- `remnaGetUser`, `remnaUpdateUser`, `remnaResetUserTraffic`, and traffic-entitlement helpers.
- Existing Prisma `Subscription` fields, including `updatedAt`, `expireAt`, `tariffId`, `trialId`, and `remnawaveUuid`.

**Interfaces produced:**

```ts
export const MANUAL_CONVERSION_QUOTE_TTL = "15m";

export type ManualConversionQuote = {
  clientId: string;
  subscriptionId: string;
  tariffId: string;
  priceOptionId: string | null;
  sourceExpireAt: string;
  sourceRevision: string;
  direction: ConversionDirection;
  commissionPercent: number;
  rawConvertedDays: number;
  convertedDays: number;
  issuedAt: number;
};

export function calculateManualConversionQuote(input: ConversionInput & {
  subscriptionId: string;
  clientId: string;
  tariffId: string;
  priceOptionId: string | null;
  sourceExpireAt: string;
  sourceRevision: string;
}): ManualConversionQuote & ConversionQuote;

export function signManualConversionQuote(quote: ManualConversionQuote): string;
export function verifyManualConversionQuote(token: string): ManualConversionQuote;
export function isManualConversionQuoteStale(
  quote: Pick<ManualConversionQuote, "sourceExpireAt" | "sourceRevision">,
  source: { expireAt: Date | null; sourceRevision: string },
): boolean;
```

**Steps:**

- [ ] Build a small Zod body schema for `{ subscriptionId, tariffId, priceOptionId }` and reject malformed input at the boundary.
- [ ] Add `POST /quote` behind `requireClientAuth`; load the owned source subscription, selected target tariff, and selected/default price option, and apply the existing trial/category eligibility rules.
- [ ] Derive whole remaining days from the source expiry, compute the raw ratio for the response, and call `quoteConvertedDays` exactly once for the authoritative direction, commission, and rounded days.
- [ ] Include source expiry and a revision derived from the source `updatedAt` in both the response and signed JWT. Include subscription id, tariff id, option id, raw converted days, and rounded converted days. Set JWT `exp` to 15 minutes and bind the quote to `clientId`.
- [ ] Return enough display data for the cabinet and bot: current tariff, target tariff, remaining days, raw days, rounding mode, commission, converted days, and total resulting days.
- [ ] Add `POST /` behind the same auth middleware. Verify signature, type, client id, expiry, and quote direction before reading the source again.
- [ ] Execute the re-read and update inside `withClientSubscriptionLock`; compare subscription id, tariff/option, source expiry, source revision, ownership, deletion/gift state, UUID presence, and tariff eligibility. Return 409 for any mismatch or expired token.
- [ ] Apply the conversion with the existing Remnawave update and traffic-entitlement helpers. Update only the existing subscription/tariff/expiry fields; preserve `remnawaveUuid`, `remnawaveShortUuid`, and the existing URL. Do not call revoke/reissue.
- [ ] For a primary subscription, keep the legacy client tariff/price fields synchronized without changing its legacy Remnawave identifiers.
- [ ] Return the applied quote/result and the preserved identifier/link needed by the UI to refresh its card.
- [ ] Mount the router after the existing `/api/client` middleware setup without changing the existing reissue endpoint.
- [ ] Run the focused backend test until GREEN, then run TypeScript checking:

```bash
cd backend
rtk npx tsx --test src/modules/client/manual-conversion.test.ts
rtk npx tsc --noEmit --pretty false
```

---

## Task 3: Add client API methods and the cabinet conversion flow

**Files:**

- Modify `frontend/src/lib/api.ts`.
- Modify `frontend/src/cabinet/pages/Tariffs.tsx`.

**Interfaces consumed:**

- The new `/api/client/subscription-conversion/quote` and `/api/client/subscription-conversion` endpoints.
- Existing `clientTariffConversionPreview`, payment methods, and tariff/price-option models.

**Interfaces produced:**

```ts
api.clientSubscriptionConversionQuote(token, {
  subscriptionId,
  tariffId,
  priceOptionId,
}): Promise<ManualConversionQuote>

api.clientSubscriptionConversion(token, {
  quoteToken,
}): Promise<ManualConversionResult>
```

**Steps:**

- [ ] Add frontend response types matching the backend quote/result fields, including source snapshot, `rawConvertedDays`, rounding, commission, direction, converted days, and total days.
- [ ] Add the two authenticated API methods using the existing `request` helper and preserve the existing 409 error shape.
- [ ] In `PlanDialog`, request a manual quote for the selected owned subscription and target option only when the user opens the conversion section; reuse the normal backend tariff preview for ordinary purchase behavior.
- [ ] Add a visible `Конвертация` action and a compact summary showing current/target tariff, remaining days, raw value, `ceil`/`floor` rounding, commission, and resulting days.
- [ ] Apply the signed quote without starting a payment. On a stale 409, discard the quote and refresh the preview so the user must confirm current data again.
- [ ] After a successful upgrade, show `Оплатить ещё месяц` and route that action back to the existing normal purchase flow. For same tariff, trial, downgrade, or equal conversion, show completion and refresh cabinet data without adding a month.
- [ ] Keep the ordinary purchase summary explicit about `convertedDays` already returned by the backend preview; do not reproduce conversion arithmetic in React.
- [ ] Build the frontend:

```bash
cd frontend
rtk npm run build
```

---

## Task 4: Add reissue confirmation in «Мои ключи»

**Files:**

- Modify `frontend/src/cabinet/pages/Keys.tsx`.

**Interfaces consumed:**

- Existing `api.reissueSubscription`.
- The active cabinet subscription source `{ type: "root" | "secondary", id }`.
- Existing cabinet auth and reload/toast patterns.

**Interfaces produced:**

- A reissue button and confirmation dialog for the active key.

**Steps:**

- [ ] Add the reissue action to the key card and keep it unavailable while the request is running.
- [ ] Require confirmation before calling the existing endpoint.
- [ ] Use the exact warning that the old link and configurations will stop working; explicitly recommend the ordinary website instead of the mini-app.
- [ ] On success, replace the displayed URL/configuration with the response and refresh the cabinet subscription; do not route this flow through manual conversion.
- [ ] Keep the action accessible and keyboard-operable using the existing dialog/button components.

---

## Task 5: Keep the bot backend-driven

**Files:**

- Modify `bot/src/api.ts`.
- Modify `bot/src/index.ts`.
- Modify `bot/src/keyboard.ts`.
- Extend the existing bot keyboard/API test only if the changed callback text needs coverage.

**Interfaces consumed:**

- Existing `tariffConversionPreview` response, which remains the source of ordinary purchase conversion data.
- New backend quote endpoint if the bot exposes a manual-conversion link/action.
- Existing reissue callbacks and `api.reissueSubscription`.

**Interfaces produced:**

- Bot API wrappers that forward quote/preview fields without calculating days locally.
- Reissue copy that warns about invalidated old links/configurations and points users to the ordinary website.

**Steps:**

- [ ] Add the smallest API wrapper needed for the new quote endpoint; return backend fields verbatim.
- [ ] Keep `showPaymentMethodsForTariff` dependent on backend `remainingDays`, `convertedDays`, and `totalDays`; do not add a second ceil/floor/commission implementation.
- [ ] Update the reissue confirmation and success texts to say the old link and configurations stop working and recommend the ordinary website rather than the mini-app.
- [ ] Keep the existing `sub:reissue` callback path and make its keyboard label unambiguous about link reissue.
- [ ] Run bot tests and build:

```bash
cd bot
rtk npm test
rtk npm run build
```

---

## Task 6: Final verification and implementation commit

**Files:**

- All implementation files from Tasks 1–5.

**Steps:**

- [ ] Run the complete required verification from the worktree:

```bash
cd backend
rtk npx tsx --test src/modules/client/manual-conversion.test.ts
rtk npx tsc --noEmit --pretty false
cd ../frontend
rtk npm run build
cd ../bot
rtk npm test
rtk npm run build
```

- [ ] Run `rtk git diff --check` and inspect `rtk git status --short`.
- [ ] Confirm no migration adds an owner-only unique index, no conversion calls reissue/revoke, and no production cleanup uses `--apply`.
- [ ] Stage only the plan/spec and owned implementation files, then create a separate implementation commit with a concise message such as `feat: add manual client subscription conversion`.
- [ ] Report the commit, changed files, and exact test commands to the user.

## Self-review checklist

- [ ] Every requirement has a concrete file/task and a runnable verification command.
- [ ] Quote claims and frontend/backend types use the same names and units.
- [ ] The stale check compares both source expiry and source revision under the lock.
- [ ] UUID/link preservation and reissue-only link mutation are tested and described.
- [ ] No placeholder text, speculative abstraction, new dependency, or owner-only database constraint is present.

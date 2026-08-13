# Task 2 report — canonical activation checkpoint

## Result

DONE_WITH_CONCERNS. The service-only canonical activation slice is green and committed. Existing Remnawave UUIDs remain the mutation target: canonical selection excludes gifts/tombstones, prefers active `subscriptionIndex=0`, and payment activation is serialized by a client-row `FOR UPDATE` transaction lock.

The first-paid-purchase bonus is calculated before the trial lock, uses trial usage/subscription/payment history, persists `firstPaidTrialBonusDays` in payment metadata for retries, and is applied to the existing activation period. Paid conversion no longer passes `hardReplace`, so a tariff change keeps pro-rata value and the existing UUID.

## TDD evidence

- RED: the initial canonical test failed because `activateTariffByPaymentIdUnlocked`/bonus integration was absent (`bonus=-1, mark=-1`).
- GREEN: `rtk npx tsx --test ./src/modules/subscription/canonical-activation.test.ts` — 5 passed.
- Type check: `rtk npx tsc --noEmit --pretty false` — no errors.
- `rtk git diff --check` — clean.

## Round 2 fix

- Replaced the client-row `FOR UPDATE` with `pg_advisory_xact_lock(hashtext(clientId))`. The transaction now remains open around the full callback without contending with the callback's existing global Prisma writes on another connection.
- Bonus metadata persistence is now required before trial usage is marked; a failed payment update returns a 500 and leaves the trial lock untouched so a retry cannot lose the bonus.
- Added an injected-transaction behavioral test proving lock → operation → commit ordering.

## Verification

- Focused canonical suite: `rtk npx tsx --test src/modules/subscription/canonical-activation.test.ts` — 7 passed.
- Type check: `rtk npx tsc --noEmit --pretty false` — no errors.
- `rtk git diff --check` — clean.

## Remaining Task 2 / concern

`balance-payment.contract.test.ts` and `trial-conversion.test.ts` still contain the pre-existing route assertions that intentionally remain RED: `/payments/balance` still owns its duplicated activation branch, and trial routes still need canonical UUID reuse. Defaults/seed changes were not touched per checkpoint scope. The activation callback still uses existing global Prisma calls; the advisory lock avoids self-deadlock, while broader transaction-client propagation remains a later migration concern.

## Round 3 transaction-client propagation

- RED evidence: before the fix, the new focused assertion failed because `activateTariffByPaymentIdUnlocked` had no `tx` parameter and still used global Prisma (`7 passed, 1 failed` in the canonical suite).
- GREEN: `activateTariffByPaymentIdUnlocked(paymentId, tx)` now uses `tx` for its direct payment/client/tariff/subscription reads and payment/client writes; the public wrapper passes the transaction client through. `calculateFirstPaidTrialBonusDays` accepts the same optional transaction-scoped database and uses it for all local history queries.
- Focused suite: `DATABASE_URL=... JWT_SECRET=... rtk npx tsx --test src/modules/subscription/canonical-activation.test.ts` — 8 passed.
- Type check: `rtk npx tsc --noEmit --pretty false` — no errors. `rtk git diff --check` — clean.

The remaining helpers invoked from activation (`extendSecondarySubscription`, `createAdditionalSubscription`, trial cleanup/consolidation, and traffic entitlement) retain their existing global Prisma dependencies in this narrow checkpoint; their optional transaction propagation is deferred to the next service migration. No route/default/trial changes or UUID/reissue behavior were added.

## Checkpoint B — balance and defaults

- RED: the new balance/default contract initially failed: the balance handler still contained direct `createAdditionalSubscription`/`findConvertibleSubscription`/`extendSecondarySubscription`/`consolidateToSingleSubscription` paths, and the config/seed fallbacks were still multi-subscription enabled by default.
- GREEN: after atomic debit and PAID `Payment` creation, `/payments/balance` now calls `activateTariffByPaymentId(payment.id)`. Refund-on-failure, promo usage, referral rewards, discount burn, notifications, response shape, and balance reporting remain in the route. The duplicated activation branch and direct activation helpers were removed.
- Defaults now resolve `multiSubscriptionsEnabled` to `false` when unset, `multi_subscriptions_enabled=false` is seeded, and the admin toggle remains authoritative. `findConvertibleSubscription` and preview/activation fallbacks also use `false`.
- Focused verification: `DATABASE_URL=... JWT_SECRET=... rtk npx tsx --test src/modules/client/balance-payment.contract.test.ts src/modules/subscription/canonical-activation.test.ts` — 11 passed.
- Type check: `rtk npx tsc --noEmit --pretty false` — no errors. `rtk git diff --check` — clean.

Remaining Task 2: trial routes and their canonical UUID/link reuse are intentionally deferred to the next checkpoint. Helper-level transaction propagation noted above also remains deferred.

## Important-fix review round

- Single-mode conversion now selects the eligible owned, non-gift `subscriptionIndex=0` record before any same-tariff fallback; gifted/deletion rows remain excluded.
- Payment activation retries require verified metadata `subscriptionActivated=true` and metadata `subscriptionId`; successful tariff, conversion, and custom paths persist both marker fields together with the Payment `subscriptionId`.
- `/payments/balance` refunds the debit and marks the Payment `FAILED` when canonical activation throws. The selected `replaceTrialSubId` is retained in `tariffMeta`.
- Verification: focused canonical/balance/tariff suites — 21 passed; `npx tsc --noEmit --pretty false` — clean; `git diff --check` — clean.
- Commit: `2c61a6d fix: make canonical activation retries idempotent`.

## Post-review rollback-hole fix

- Trial cleanup after a successful Remnawave extend/conversion is now best-effort and logged; cleanup errors cannot roll back the persisted activation marker or make balance payment activation fail.
- Single-mode canonical lookup now reuses `selectCanonicalSubscription`: active eligible rows win over expired rows, then index `0` wins among equally active records, with deterministic expiry fallback. This preserves an active secondary UUID when a stale index-zero row remains.
- Verification: focused canonical/balance/tariff suites — 23 passed; `npx tsc --noEmit --pretty false` — clean; `git diff --check` — clean.
- Commit: `1c45424 fix: preserve activation marker after trial cleanup`.

## Final cleanup rollback-hole fix

- Gift cleanup after new tariff activation and all custom-build trial cleanup now run through `bestEffortTrialCleanup` after `persistActivation`; custom cleanup no longer runs before Remnawave creation.
- Verification: focused canonical/balance/tariff suites — 24 passed; `npx tsc --noEmit --pretty false` — clean; `git diff --check` — clean.
- Commit: `c4df082 fix: make new activation cleanup best effort`.

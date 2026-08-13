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

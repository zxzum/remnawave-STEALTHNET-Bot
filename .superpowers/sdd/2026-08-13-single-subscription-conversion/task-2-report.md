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

# Task 2 report — canonical activation checkpoint

## Result

DONE_WITH_CONCERNS. The service-only canonical activation slice is green and committed. Existing Remnawave UUIDs remain the mutation target: canonical selection excludes gifts/tombstones, prefers active `subscriptionIndex=0`, and payment activation is serialized by a client-row `FOR UPDATE` transaction lock.

The first-paid-purchase bonus is calculated before the trial lock, uses trial usage/subscription/payment history, persists `firstPaidTrialBonusDays` in payment metadata for retries, and is applied to the existing activation period. Paid conversion no longer passes `hardReplace`, so a tariff change keeps pro-rata value and the existing UUID.

## TDD evidence

- RED: the initial canonical test failed because `activateTariffByPaymentIdUnlocked`/bonus integration was absent (`bonus=-1, mark=-1`).
- GREEN: `rtk npx tsx --test ./src/modules/subscription/canonical-activation.test.ts` — 5 passed.
- Type check: `rtk npx tsc --noEmit --pretty false` — no errors.
- `rtk git diff --check` — clean.

## Commit

Pending final commit in this checkpoint.

## Remaining Task 2 / concern

`balance-payment.contract.test.ts` and `trial-conversion.test.ts` still contain the pre-existing route assertions that intentionally remain RED: `/payments/balance` still owns its duplicated activation branch, and trial routes still need canonical UUID reuse. Defaults/seed changes were not touched per checkpoint scope. The transaction callback currently exposes the requested `Prisma.TransactionClient` interface, while the broader route/service migration must move all activation reads/writes onto that transaction in the next checkpoint.

# Task 4 report — RollyPay configuration and purchase surfaces

## Status

Implemented for Лазейка ВПН.

## Implementation

- Added safe RollyPay system-setting defaults, admin persistence, test-mode/enable toggles, and append-only provider ordering.
- Public config exposes only `rollypayEnabled`, and only when the admin flag plus nonblank API key and signing secret are present. Secrets are not included in public config.
- Added `POST /api/client/rollypay/create-payment` with the existing tariff/product pricing, personal discount, promo, ownership, cooldown, snapshots, and pending-payment flow. Product currency is preserved; non-RUB RollyPay payments return `400`.
- Mounted the raw-body RollyPay webhook before the generic JSON parser. Task 3 RollyPay service/webhook core and lifecycle activation flow were left unchanged.
- Added RollyPay to active cabinet tariff, balance top-up, service/option, and subscription-extension purchase selectors, gated by RUB and public enablement.
- Added bot tariff/top-up selectors and callbacks, including the single-provider top-up path.

## Commit

- Implementation: `d3759b9` (`feat: add RollyPay configuration and purchase surfaces`)

## Verification

- Backend tests: 31 passed.
- Bot tests: 25 passed.
- Task 4 contract tests: 4 passed.
- Backend build: passed.
- Frontend build: passed.
- Bot build: passed.
- `git diff --check`: passed.

## Concerns

- No live RollyPay API/webhook test was run because external credentials/service access were not available.
- Frontend Vite reports the repository's existing large-chunk warning (>500 kB); the build still succeeds.

## Round 1/5 remediation

- Added `rollypay` to the centralized `markPaymentPaid` top-up classification, retaining the existing pending-only flip so retries credit balance once.
- Preserved `targetSubscriptionId` in RollyPay extra-option metadata before the payment snapshot is persisted.
- Recorded promo usage after successful RollyPay `markPaymentPaid`; the existing shared helper remains the retry-idempotent guard.
- Made RollyPay proxy and Sing-box product amounts/currencies come from active DB tariffs; caller `amount` remains a pure top-up input only, and non-RUB/missing/inactive products are rejected.

## Round 1/5 verification

- Focused round-1 contracts: 4 passed.
- Full backend tests: 31 passed.
- Backend build: passed.
- Frontend build: passed.
- Bot build: passed.
- `git diff --check`: passed.

## Round 1/5 commit

- `e66d3af` (`fix: close RollyPay Task 4 payment findings`)

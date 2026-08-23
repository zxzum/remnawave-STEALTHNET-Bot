# Task 3 Report: RollyPay core and secure webhook

## Status

Implemented and committed.

Code commit: `c905b72 feat: add RollyPay core and secure webhook`

## Implemented

- Added RollyPay creation and status lookup against the documented API.
- Added fresh `X-Nonce`, `X-API-Key`, timeout handling, and existing payment-proxy support for both API calls.
- Enforced RUB-only creation and webhook reconciliation.
- Added raw-body HMAC-SHA256 verification with `X-Timestamp` replay protection.
- Webhook confirmation now matches provider payment ID, order ID, paid status, RUB currency, and amount before updating the provider ID and calling only `markPaymentPaid`.
- Transient status lookup and completion failures return retryable HTTP 503 responses.

## TDD and verification

Red phase:

- Focused tests failed as expected because the new service module did not exist.

Green/final checks:

- Focused RollyPay tests: 12 passed, 0 failed.
- `rtk npm run build` in `backend`: passed.
- Staged `git diff --cached --check`: passed.

## Concerns

- Task 4 remains responsible for settings, purchase-surface wiring, raw-body middleware mounting, and public route registration; none were added here.
- Tests do not call the live RollyPay service. Existing Node/tsx deprecation warnings remain non-blocking.

## Fix round 1/5

- HTTP 408 Request Timeout is now classified as transient, so webhook status lookup failures return retryable HTTP 503.
- Webhook amounts must be canonical two-decimal strings and must exactly equal `localPayment.amount.toFixed(2)`; values such as `99.996` no longer round into a false match. The valid `100.00` path remains covered.

### TDD evidence

Red:

- Focused command: `rtk npx --no-install tsx --test src/modules/rollypay/rollypay.service.test.ts src/modules/webhooks/rollypay-webhook-policy.test.ts`
- Result: 13 tests, 11 passed, 2 failed — the new 408 case was `remote_rejection`, and `99.996` incorrectly matched.

Green/final checks:

- Focused RollyPay tests: 13 passed, 0 failed.
- `rtk npm run build` in `backend`: passed (`tsc` exit 0).
- Self-review: only the shared lookup classifier, shared amount policy, focused tests, and this report changed; no settings/UI work was added.

## Fix round 2/5

- Numeric provider amounts are now accepted when they have at most two decimal places: `100` normalizes to `100.00` and `99.9` to `99.90` without rounding. Numeric `99.996` remains non-fulfilling.
- String provider amounts still require the exact canonical `\d+\.\d{2}` form.

### TDD evidence

Red:

- Focused command: `rtk npx --no-install tsx --test src/modules/rollypay/rollypay.service.test.ts src/modules/webhooks/rollypay-webhook-policy.test.ts`
- Result: 14 tests, 13 passed, 1 failed — numeric provider amounts were rejected by the string-only validator.

Green/final checks:

- Focused RollyPay tests: 14 passed, 0 failed.
- `rtk npm run build` in `backend`: passed (`tsc` exit 0).
- One initial build caught and was fixed before final verification: TypeScript correctly required narrowing the numeric amount branch from `string | number | undefined`.
- Self-review: only numeric amount normalization, its focused tests, and this report changed; mismatch still returns non-fulfilling validation and no settings/UI scope was added.

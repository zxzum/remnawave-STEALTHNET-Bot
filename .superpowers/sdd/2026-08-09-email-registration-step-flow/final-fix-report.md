# Лазейка ВПН email-registration final fix wave

Date: 2026-08-09
Base: `e593cd2`
Scope: final whole-branch review findings for the approved email-registration step flow.

## Resolutions

### Important 1 — completion race on `Client.email`

Completion now runs through `email-registration-completion.ts`. The transaction adapter takes a PostgreSQL transaction-scoped advisory lock for the normalized email, then the helper re-reads the pending row and rechecks `Client.email` while that lock is held. It validates the token, verification timestamp, revocation state, delivery state, and expiry from the locked read before creating the Client and deleting the pending row.

The route keeps the existing public responses: an already-existing email is a deterministic 400, an invalid or consumed link is the existing invalid-link 400, and a successful completion returns the normal 201. A Prisma `P2002` for an email unique constraint is also mapped to the existing-email 400, covering a race with a writer that does not participate in the advisory lock. Other database errors are still propagated instead of being hidden.

### Important 2 — SMTP success and older-link revocation

`PendingEmailRegistration.deliveryState` was added as an additive nullable-free text column with a `SENT` default in migration `20260809010000_email_registration_delivery_state`. Existing rows therefore retain their prior behavior; new rows start in `SENDING`.

The delivery transition is now durable and transaction-scoped:

- A failed SMTP delivery leaves the new row in `SENDING`, does not revoke any older row, and returns the existing delivery-failure response. Verification and completion reject a `SENDING` row, so the previous `SENT` link remains usable.
- A successful delivery re-acquires the email advisory lock, re-reads the pending row, marks it `SENT`, and revokes all older non-revoked rows in the same database transaction. The state change and revocation therefore commit or roll back together.
- The finalization helper is idempotent: replaying it does not repeat the state mutation and repeats the revocation as an idempotent `updateMany`. If the post-send transaction fails, the route reports the failure instead of swallowing it; the durable `SENDING` row preserves the old link, and a later successful replacement finalization revokes that row together with all other older links.

The unavoidable SMTP/DB boundary is handled as a retryable state transition: an external SMTP send cannot be rolled back, but no older valid link is revoked until the successful-send state is durably committed. There is no live SMTP/database reconciliation worker in this scope; the retry path is the recovery mechanism and is covered at the helper/DB-boundary level.

### Important 3 — executable coverage

Coverage was strengthened without adding runtime dependencies or introducing an application-wide mock framework:

- `email-registration-policy.test.ts` exercises the 60-second email decision, the IP-window decision, future-timestamp handling, and the exact 429 decision object.
- `email-registration-delivery.test.ts` exercises pure failed/successful transitions, verifies that failed delivery makes no state or revocation calls at the store boundary, and verifies replay-safe successful finalization.
- `email-registration-completion.test.ts` runs two concurrent completions against a small in-memory store and asserts exactly one Client creation, one pending-row deletion, and the exact password/create inputs. It also exercises the locked existing-email recheck and Prisma email-unique classification.
- The existing route/schema contract test now checks the transaction lock, state gates, and completion helper wiring. It remains a boundary contract because this workspace has no live test database or SMTP service.
- `frontend/src/cabinet/runtime.test.mjs` asserts the password submit control includes the loading guard.

### Minor 1 — future timestamps

`getEmailRegistrationRetryAfter` now ignores both a future `lastEmailSentAt` and future IP send timestamps. Existing cooldown and rolling-window limits remain unchanged for timestamps at or before `now`.

### Minor 2 — password duplicate-submit guard

The password-step submit button in `Auth.tsx` is disabled when `loading` is true, in addition to the existing password validation conditions, with a focused runtime assertion.

## Verification

- Focused backend behavior/contracts: `rtk npm exec -- tsx --test src/modules/client/email-registration-policy.test.ts src/modules/client/email-registration-delivery.test.ts src/modules/client/email-registration-completion.test.ts src/modules/client/email-registration.contract.test.ts` — 17 passed, 0 failed.
- Backend package test command: `rtk npm test` — 17 passed, 0 failed.
- Prisma client generation: `rtk npm run db:generate` — passed.
- Backend build: `rtk npm run build` — passed.
- Frontend runtime tests: `rtk node --test src/cabinet/runtime.test.mjs` — 33 passed, 1 failed. The new password-loading test passed; the sole failure is the unchanged pre-existing `admin settings no longer expose the archived design selector` assertion at `frontend/src/cabinet/runtime.test.mjs:192`.
- Frontend build: `rtk npm run build` — passed. Existing warnings remain for chunks larger than 500 kB.
- Working-tree diff check: `rtk git diff --check` — passed.

## Deferred ledger preserved

- The prior frontend runtime result was 32/33 with the same archived-design-selector failure. This wave adds one passing test, so the current result is 33/34; the unrelated failing assertion was not changed.
- Existing frontend build-size warnings remain documented and were not addressed in this narrowly scoped wave.
- No live database/SMTP end-to-end test was added. The completion and delivery tests cover the pure transition and precise persistence boundaries without inventing a new runtime dependency or broad mock harness.

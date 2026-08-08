# Email Registration Step Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Лазейка ВПН create an email account only after the confirmation link is opened and a password is saved, while keeping `skipEmailVerification` as the direct email → password path.

**Architecture:** Reuse `PendingEmailRegistration` as the pre-account state. Email registration creates a pending row without a password, verification marks that row as verified and returns a registration token, and a new completion endpoint atomically creates the `Client` after password submission. The existing client auth context carries the verified-but-not-created state through the browser; the existing cabinet dashboard gets a query-driven success modal.

**Tech Stack:** TypeScript, Express, Prisma/PostgreSQL, React 18, React Router, Radix Dialog, Node `node:test`, `tsx`.

## Global Constraints

- Preserve the product name **Лазейка ВПН** in user-facing copy; keep legacy technical identifiers unchanged.
- Do not store or hash a registration password before the email link is confirmed.
- `skipEmailVerification=true` must not send email and must move directly from email to password.
- Rate limiting is backend-enforced: 60-second cooldown per normalized email and at most 5 verification sends per IP in one hour; the existing `/register` edge limiter remains active.
- Old verification links become invalid only after a replacement email has been sent successfully.
- Keep the existing optional 2FA step and existing Telegram-linking APIs.
- No new runtime dependency.

---

### Task 1: Add tested email-verification rate policy

**Files:**
- Create: `backend/src/modules/client/email-registration-policy.ts`
- Test: `backend/src/modules/client/email-registration-policy.test.ts`

**Interfaces:**
- Produces `EMAIL_VERIFICATION_COOLDOWN_MS = 60_000`.
- Produces `EMAIL_VERIFICATION_IP_WINDOW_MS = 60 * 60_000`.
- Produces `EMAIL_VERIFICATION_IP_MAX = 5`.
- Produces `getEmailRegistrationRetryAfter(now: Date, lastEmailSentAt: Date | null, ipSendTimes: readonly Date[]): number | null`, returning seconds or `null` when neither limit applies.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  EMAIL_VERIFICATION_IP_MAX,
  getEmailRegistrationRetryAfter,
} from "./email-registration-policy.js";

const now = new Date("2026-08-09T12:00:00.000Z");

test("limits the same email for 60 seconds", async () => {
  assert.equal(
    getEmailRegistrationRetryAfter(now, new Date("2026-08-09T11:59:30.000Z"), []),
    30,
  );
});

test("limits the fifth IP send until the oldest send leaves the hour", async () => {
  const sends = Array.from({ length: EMAIL_VERIFICATION_IP_MAX }, (_, index) =>
    new Date(now.getTime() - (10 + index * 10) * 60_000),
  );
  assert.equal(getEmailRegistrationRetryAfter(now, null, sends), 600);
});

test("allows a request outside both windows", async () => {
  assert.equal(getEmailRegistrationRetryAfter(now, new Date("2026-08-09T11:00:00.000Z"), []), null);
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the missing policy module**

Run: `npm exec tsx -- --test src/modules/client/email-registration-policy.test.ts` from `backend/`.

Expected: FAIL because `email-registration-policy.ts` does not exist yet.

- [ ] **Step 3: Implement the smallest pure policy**

Implement the three constants and calculate the maximum retry delay from the email cooldown and the oldest of the five in-window IP sends. Ignore timestamps outside the one-hour window; return `Math.max(1, Math.ceil(remainingMs / 1000))` for an active limit.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm exec tsx -- --test src/modules/client/email-registration-policy.test.ts` from `backend/`.

Expected: PASS with three tests.

- [ ] **Step 5: Commit the policy test and implementation**

```bash
git add backend/src/modules/client/email-registration-policy.ts backend/src/modules/client/email-registration-policy.test.ts
git commit -m "test: add email registration rate policy"
```

### Task 2: Move email registration state to confirmation-then-password

**Files:**
- Modify: `backend/prisma/schema.prisma:282-301`
- Create: `backend/prisma/migrations/20260809000000_email_registration_password_step/migration.sql`
- Modify: `backend/src/modules/client/client.routes.ts:170-574`
- Create: `backend/src/modules/client/email-registration.contract.test.ts`

**Interfaces:**
- `POST /client/auth/register` accepts `{ email, ...metadata }` without a password when confirmation is enabled and returns `{ requiresVerification: true }` after the email is sent.
- `POST /client/auth/verify-email` returns `{ registrationToken: string, email: string }` for a new pending registration and never creates a `Client`.
- `POST /client/auth/complete-registration` accepts `{ token: string, password: string }` and returns the normal `ClientAuthResponse`.
- Existing Telegram registration and `skipEmailVerification` email+password registration remain unchanged.

- [ ] **Step 1: Write failing route/schema contract tests**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const routes = readFileSync(new URL("./client.routes.ts", import.meta.url), "utf8");

test("pending registrations can wait for the password and track verification state", () => {
  assert.match(schema, /passwordHash\s+String\?/);
  assert.match(schema, /emailVerifiedAt\s+DateTime\?/);
  assert.match(schema, /registrationIp\s+String\?/);
  assert.match(schema, /revokedAt\s+DateTime\?/);
});

test("verification does not create a client and completion owns client creation", () => {
  const verifyStart = routes.indexOf('clientAuthRouter.post("/verify-email"');
  const loginStart = routes.indexOf('const loginSchema', verifyStart);
  const verifyBlock = routes.slice(verifyStart, loginStart);
  assert.doesNotMatch(verifyBlock, /prisma\.client\.create/);
  assert.match(verifyBlock, /emailVerifiedAt/);
  assert.match(routes, /clientAuthRouter.post\("\/complete-registration"/);
});

test("registration sends no password hash before the email is verified", () => {
  const registerStart = routes.indexOf('clientAuthRouter.post("/register"');
  const verifyStart = routes.indexOf('const verifyEmailSchema', registerStart);
  const registerBlock = routes.slice(registerStart, verifyStart);
  const pendingCreateStart = registerBlock.indexOf("pendingEmailRegistration.create");
  const pendingCreateEnd = registerBlock.indexOf("});", pendingCreateStart);
  const pendingCreateBlock = registerBlock.slice(pendingCreateStart, pendingCreateEnd);
  assert.match(registerBlock, /pendingEmailRegistration\.create/);
  assert.match(registerBlock, /getEmailRegistrationRetryAfter/);
  assert.match(pendingCreateBlock, /passwordHash:\s*null/);
});
```

- [ ] **Step 2: Run the contract tests and verify they fail against the current flow**

Run: `npm exec tsx -- --test src/modules/client/email-registration.contract.test.ts` from `backend/`.

Expected: FAIL because the schema requires `passwordHash`, verification creates the client, and no completion endpoint exists.

- [ ] **Step 3: Add the Prisma fields and migration**

Change `PendingEmailRegistration` to make `passwordHash` nullable and add nullable `emailVerifiedAt`, `registrationIp`, and `revokedAt`. Add indexes for `email, createdAt` and `registrationIp, createdAt`. The migration must alter `password_hash` to nullable, add the three columns, and create the two indexes without deleting existing pending rows.

- [ ] **Step 4: Update `/register` with the two modes and persistent limits**

In `client.routes.ts`, split `hasEmail` from `hasPassword`. For `skipEmailVerification`, reject an email-only request and keep the existing immediate email+password creation. For confirmation mode, look up the newest active pending row for the normalized email, count pending sends from the request IP during the one-hour window, call `getEmailRegistrationRetryAfter`, and return 429 with `Retry-After` and `retryAfter` when limited.

Create the pending row with `passwordHash: null`, the request IP, a fresh verification token, metadata, and the 24-hour expiry. Send the email. If sending fails, delete only the new row so the previous valid link remains. After a successful send, set `revokedAt` on older rows for that email. Keep the existing blocklist, SMTP, public URL, referral, UTM, and bot-auth checks.

- [ ] **Step 5: Change `/verify-email` to mark only the pending row**

Keep token and expiry validation. Preserve the existing-client compatibility branch for legacy pending rows, but for a pending registration without an existing client update `emailVerifiedAt` and return `{ registrationToken: pending.verificationToken, email: pending.email }`. Do not call `prisma.client.create`, notify admins, issue a client JWT, or delete the pending row in this branch.

- [ ] **Step 6: Add atomic `/complete-registration`**

Validate the token and password with Zod, reject missing, expired, revoked, or not-yet-verified pending rows, and reject a second completion after the row has been deleted. Recompute the referral target and load the primary bot/config exactly as the old verification path did. Hash the submitted password, create the client and delete the pending row in one `prisma.$transaction`, copy the pending metadata, notify admins after commit, and return `signClientToken(client.id)` plus `toClientShape(client)`. This is the only confirmation-mode path that creates the `Client`.

- [ ] **Step 7: Generate Prisma client, run backend contract tests, and build**

Run from `backend/`:

```bash
npm run db:generate
npm exec tsx -- --test src/modules/client/email-registration-policy.test.ts src/modules/client/email-registration.contract.test.ts
npm run build
```

Expected: all focused tests PASS and TypeScript compilation succeeds.

- [ ] **Step 8: Commit the backend flow**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260809000000_email_registration_password_step/migration.sql backend/src/modules/client/client.routes.ts backend/src/modules/client/email-registration.contract.test.ts
git commit -m "feat: defer email account creation until password setup"
```

### Task 3: Connect the frontend email, verification, password, and success-modal flow

**Files:**
- Modify: `frontend/src/lib/api.ts:2074-2086,5155-5185`
- Modify: `frontend/src/contexts/client-auth.tsx:34-55,230-310,365-390`
- Modify: `frontend/src/cabinet/pages/AccountFlows.tsx:89-115`
- Modify: `frontend/src/cabinet/pages/Auth.tsx:310-612`
- Modify: `frontend/src/cabinet/pages/Cabinet.tsx:289-392`
- Modify: `frontend/src/cabinet/runtime.test.mjs`

**Interfaces:**
- `ClientRegistrationVerification = { registrationToken: string; email: string }`.
- `api.clientCompleteRegistration(token: string, password: string): Promise<ClientAuthResponse>`.
- `useClientAuth().completeRegistration(token, password): Promise<void>` stores the returned client session.
- `useClientAuth().verifyEmail(token)` returns the verification result without creating client auth for a pending registration.

- [ ] **Step 1: Add failing frontend contract assertions**

Append tests to `frontend/src/cabinet/runtime.test.mjs` that assert:

```js
test("registration verifies email before account creation", async () => {
  const auth = await readFile(new URL("./pages/Auth.tsx", import.meta.url), "utf8");
  const flows = await readFile(new URL("./pages/AccountFlows.tsx", import.meta.url), "utf8");
  const context = await readFile(new URL("../contexts/client-auth.tsx", import.meta.url), "utf8");
  assert.match(auth, /skipEmailVerification/);
  assert.match(auth, /completeRegistration/);
  assert.match(auth, /registrationToken/);
  assert.match(flows, /cabinet\/register\?registrationToken=/);
  assert.match(context, /completeRegistration/);
});

test("registration success modal recommends Telegram settings", async () => {
  const cabinet = await readFile(new URL("./pages/Cabinet.tsx", import.meta.url), "utf8");
  assert.match(cabinet, /registration=success/);
  assert.match(cabinet, /Аккаунт успешно создан/);
  assert.match(cabinet, /настройк/);
});
```

- [ ] **Step 2: Run the focused frontend test and verify it fails**

Run: `node --test src/cabinet/runtime.test.mjs` from `frontend/`.

Expected: FAIL because the current auth flow still has the welcome step, no completion API/context method, and no registration success modal.

- [ ] **Step 3: Add frontend API types and methods**

Add the verification response type, extend the `clientRegister` and `clientVerifyEmail` unions, and add `clientCompleteRegistration` calling `/client/auth/complete-registration` with `{ token, password }`. Keep the existing email-link verification method and response types unchanged.

- [ ] **Step 4: Extend `ClientAuthProvider` without changing Telegram/OAuth flows**

Allow `register` to receive an optional password. Make `verifyEmail` return the pending verification result and stop treating that result as a full auth response. Add `completeRegistration` that calls the new API, stores the client token/profile, and preserves the existing `requires2FA` handling. Add the method to `ClientAuthValue` and the provider value.

- [ ] **Step 5: Redirect verified email links to the password step**

In `AccountFlows.tsx`, branch on `registrationToken` for the non-link-email verification flow. Display `Email подтверждён, создайте пароль`, and make the success button navigate to `/cabinet/register?registrationToken=...&email=...` with encoded query values. Keep `/verify-link-email` behavior unchanged and never redirect a new registration directly to the dashboard.

- [ ] **Step 6: Simplify `Register` to the approved step order**

In `Auth.tsx`, remove the pre-verification welcome step. Read `registrationToken` and `email` from search params; if a token is present, open directly on the password step. For confirmation mode, the email action calls `register({ email, ...metadata })`, shows an alert containing the exact email, and exposes a resend action using the same function. For `skipEmailVerification`, the email action only moves to password and does not call the email endpoint.

On password submit, call `completeRegistration(registrationToken, password)` for a verified flow; otherwise call the existing `register({ email, password, ...metadata })`. Keep the current validation, loading, error, referral, UTM, and optional 2FA behavior. After onboarding completion, navigate to `/cabinet/dashboard?registration=success`.

- [ ] **Step 7: Add the success modal to the existing cabinet dashboard**

In `Cabinet.tsx`, reuse the existing Radix Dialog styling. Open the modal when `registration=success`, clear the query on close, show «Аккаунт успешно создан» and recommend linking Telegram in profile settings, and provide «Открыть настройки» → `/cabinet/profile` plus «Позже». Render it in both empty-subscription and normal dashboard branches so the post-registration modal is not lost for a new client without a subscription.

- [ ] **Step 8: Run frontend tests and build**

Run from `frontend/`:

```bash
node --test src/cabinet/runtime.test.mjs
npm run build
```

Expected: all runtime tests PASS and the production TypeScript/Vite build succeeds.

- [ ] **Step 9: Commit the frontend flow**

```bash
git add frontend/src/lib/api.ts frontend/src/contexts/client-auth.tsx frontend/src/cabinet/pages/AccountFlows.tsx frontend/src/cabinet/pages/Auth.tsx frontend/src/cabinet/pages/Cabinet.tsx frontend/src/cabinet/runtime.test.mjs
git commit -m "feat: guide email registration through password setup"
```

### Task 4: Verify the complete registration flow

**Files:**
- No committed files; use the existing local app and temporary screenshots outside the repository.

- [ ] **Step 1: Run the full backend test suite**

Run: `npm test` from `backend/`.

Expected: all backend tests PASS with no new warnings.

- [ ] **Step 2: Run the full frontend build and runtime tests**

Run from `frontend/`:

```bash
node --test src/cabinet/runtime.test.mjs
npm run build
```

Expected: tests PASS and Vite/TypeScript build succeeds.

- [ ] **Step 3: Exercise the rendered route with the Browser plugin**

Use the Browser skill against the local frontend and verify:

1. `/cabinet/register` shows email first and no «Аккаунт успешно создан» welcome screen.
2. With confirmation enabled, submit `user@example.com` and observe the alert naming that exact address plus the resend control.
3. Open a verification URL in a fresh tab and observe the password step, not an authenticated dashboard.
4. Complete the password and observe the dashboard success modal with the Telegram-settings recommendation.
5. Close with «Позже» and confirm the modal does not repeat during the same URL state.
6. With `skipEmailVerification=true`, confirm email submission moves directly to password without a mail request.

Capture only useful screenshots outside the repository and check console errors, URL transitions, and visible text.

- [ ] **Step 4: Review final diff and migration status**

Run:

```bash
git diff --check
git status --short
```

Confirm only intended registration files and the new migration are committed; preserve unrelated existing changes in `.vscode/settings.json`, `AGENTS.md`, and existing untracked planning documents.

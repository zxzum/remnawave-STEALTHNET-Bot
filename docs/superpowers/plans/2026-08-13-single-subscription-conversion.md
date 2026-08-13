# Single Subscription Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make single-subscription mode cover every Лазейка ВПН subscription flow while preserving every currently used Remnawave UUID/link, adding deterministic conversion, first-purchase trial bonus, secure link rotation, reversible multi-subscription mode, and safe duplicate cleanup.

**Architecture:** Reuse the unified `Subscription` model and existing `extendSecondarySubscription` path. Extract pure quote policy, route all paid activation through `activateTariffByPaymentId`, and make single-mode selection update `subscriptionIndex=0` instead of creating another Remnawave user. Keep `multiSubscriptionsEnabled` reversible; no owner-only unique index. Persist only link-rotation time/short UUID, and use the existing lifecycle for cleanup.

**Tech Stack:** TypeScript, Node test runner, Express, Prisma/PostgreSQL, React, Remnawave HTTP API.

## Global Constraints

- Product name is **Лазейка ВПН**; legacy `stealthnet` technical identifiers remain unchanged.
- Existing working `remnawaveUuid` and subscription links must never change during trial, purchase, conversion, gift redemption, admin grant, auto-renewal, or migration.
- A link changes only after explicit user reissue confirmation; successful reissue is limited to once per 6 hours per account.
- `multiSubscriptionsEnabled=false` enforces one active owned subscription across categories; `true` restores multiple subscriptions without a schema rollback.
- No owner-only unique index may be added.
- Upgrade conversion uses `ceil(value/new daily price)` only when raw days are at least 1; downgrade uses `floor(value*0.95/new daily price)`; same tariff has no commission.
- First paid purchase without any trial/subscription history adds the minimum active trial duration exactly once.
- `vssarovv` keeps the active key and deletes only the old subscription; `sallyqx` keeps `Стандарт` and deletes only `Обычный ВПН`; ambiguity stops cleanup before mutation.
- Every production behavior is implemented test-first and verified RED then GREEN.

---

### Task 1: Pure conversion and first-purchase bonus policy

**Files:**
- Create: `backend/src/modules/subscription/subscription-change.policy.ts`
- Create: `backend/src/modules/subscription/subscription-change.policy.test.ts`
- Modify: `backend/src/modules/tariff/tariff-activation.service.ts`
- Modify: `backend/src/modules/tariff/tariff-activation.service.test.ts`

**Interfaces:**
- Produces `quoteConvertedDays(input: ConversionInput): ConversionQuote`.
- Produces `minimumEligibleTrialBonus(input: TrialBonusInput): number`.
- `computeConvertedDays` becomes a compatibility wrapper over `quoteConvertedDays` until all callers move.

- [ ] **Step 1: Write failing policy tests**

```ts
test("upgrade is loyal but requires one raw day", () => {
  assert.deepEqual(quoteConvertedDays({ remainingDays: 11, oldPricePerDay: 10, newPricePerDay: 20, sameTariff: false, isTrial: false }),
    { allowed: true, direction: "upgrade", convertedDays: 6, commissionPercent: 0 });
  assert.equal(quoteConvertedDays({ remainingDays: 1, oldPricePerDay: 10, newPricePerDay: 20, sameTariff: false, isTrial: false }).allowed, false);
});

test("downgrade charges five percent and floors", () => {
  assert.deepEqual(quoteConvertedDays({ remainingDays: 30, oldPricePerDay: 20, newPricePerDay: 10, sameTariff: false, isTrial: false }),
    { allowed: true, direction: "downgrade", convertedDays: 57, commissionPercent: 5 });
});

test("same tariff and trial preserve remaining whole days without commission", () => {
  assert.equal(quoteConvertedDays({ remainingDays: 8, oldPricePerDay: 10, newPricePerDay: 10, sameTariff: true, isTrial: false }).convertedDays, 8);
  assert.equal(quoteConvertedDays({ remainingDays: 8, oldPricePerDay: null, newPricePerDay: 10, sameTariff: false, isTrial: true }).convertedDays, 8);
});

test("first paid purchase receives minimum active trial duration exactly once", () => {
  assert.equal(minimumEligibleTrialBonus({ activeTrialDurations: [7, 3, 14], trialEverUsed: false, subscriptionEverExisted: false, priorPaidPurchase: false }), 3);
  assert.equal(minimumEligibleTrialBonus({ activeTrialDurations: [3], trialEverUsed: true, subscriptionEverExisted: false, priorPaidPurchase: false }), 0);
});
```

- [ ] **Step 2: Run RED**

Run: `cd backend && rtk npm test -- src/modules/subscription/subscription-change.policy.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal pure policy**

```ts
export function quoteConvertedDays(input: ConversionInput): ConversionQuote {
  const remaining = Math.max(0, Math.floor(input.remainingDays));
  if (remaining === 0) return { allowed: false, direction: "none", convertedDays: 0, commissionPercent: 0 };
  if (input.sameTariff || input.isTrial) return { allowed: true, direction: input.sameTariff ? "same" : "trial", convertedDays: remaining, commissionPercent: 0 };
  if (!input.oldPricePerDay || input.oldPricePerDay <= 0 || input.newPricePerDay <= 0) return { allowed: false, direction: "none", convertedDays: 0, commissionPercent: 0 };
  const raw = remaining * input.oldPricePerDay / input.newPricePerDay;
  if (input.newPricePerDay > input.oldPricePerDay) return { allowed: raw >= 1, direction: "upgrade", convertedDays: raw >= 1 ? Math.ceil(raw) : 0, commissionPercent: 0 };
  if (input.newPricePerDay < input.oldPricePerDay) return { allowed: true, direction: "downgrade", convertedDays: Math.floor(raw * 0.95), commissionPercent: 5 };
  return { allowed: true, direction: "equal", convertedDays: Math.floor(raw), commissionPercent: 0 };
}
```

`minimumEligibleTrialBonus` returns `Math.min(...activeTrialDurations)` only when all three history booleans are false and the list contains positive days.

- [ ] **Step 4: Replace conversion callers without changing UUID behavior**

Update `extendSecondarySubscription` and `/tariff-conversion-preview` to consume the quote result. Remove `hardReplace` day loss in single mode. Keep the existing Remnawave PATCH using `sec.remnawaveUuid`.

- [ ] **Step 5: Run GREEN and regression tests**

Run: `cd backend && rtk npm test -- src/modules/subscription/subscription-change.policy.test.ts src/modules/tariff/tariff-activation.service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add backend/src/modules/subscription/subscription-change.policy.ts backend/src/modules/subscription/subscription-change.policy.test.ts backend/src/modules/tariff/tariff-activation.service.ts backend/src/modules/tariff/tariff-activation.service.test.ts
rtk git commit -m "feat: define subscription conversion policy"
```

### Task 2: Canonical single-mode activation for payment, balance, and trial

**Files:**
- Modify: `backend/src/modules/tariff/tariff-activation.service.ts`
- Modify: `backend/src/modules/client/client.routes.ts`
- Modify: `backend/src/modules/client/client.service.ts`
- Modify: `backend/src/scripts/seed-system-settings.ts`
- Create: `backend/src/modules/subscription/canonical-activation.test.ts`
- Modify: `backend/src/modules/client/balance-payment.contract.test.ts`
- Modify: `backend/src/modules/tariff/trial-conversion.test.ts`

**Interfaces:**
- Produces `withClientSubscriptionLock<T>(clientId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>` using a PostgreSQL advisory transaction lock or locked Client row; every read/write in the callback uses `tx`.
- Produces `resolveCanonicalSubscription(clientId: string): Promise<Subscription | null>` selecting active, non-gift `subscriptionIndex=0` first.
- All paid balance activation calls `activateTariffByPaymentId(payment.id)` after the atomic debit instead of duplicating candidate/create logic.

- [ ] **Step 1: Write failing canonical activation tests**

Tests must prove:

```ts
assert.equal(remnaCreateCalls, 0);
assert.equal(remnaUpdateCalls[0].uuid, "existing-working-uuid");
assert.equal(savedSubscriptionId, "canonical-sub-0");
assert.equal(savedSubscriptionCount, 1);
```

Cover trial -> paid, paid -> other category, two simultaneous activation calls, and a fresh client. The fresh client expects one create; every existing-client case expects zero creates.

- [ ] **Step 2: Run RED**

Run: `cd backend && rtk npm test -- src/modules/subscription/canonical-activation.test.ts src/modules/client/balance-payment.contract.test.ts src/modules/tariff/trial-conversion.test.ts`

Expected: FAIL because balance/trial still have create paths and single mode defaults true/multi.

- [ ] **Step 3: Make single mode the default without removing multi mode**

Change fallbacks from `?? true` to `?? false`, seed `multi_subscriptions_enabled=false`, and keep the admin toggle. Do not add a schema uniqueness constraint.

- [ ] **Step 4: Serialize and reuse the canonical record**

Wrap activation in the client lock. In `findConvertibleSubscription(..., false)`, always choose the canonical owned non-gift record. Pass conversion mode for a different tariff and never `hardReplace`. Call `createAdditionalSubscription` only when no canonical record exists.

- [ ] **Step 5: Add first-purchase trial bonus inside the locked activation**

Read active `Trial.durationDays`, `Client.trialUsed`, `ClientTrialUsage`, existing/current subscriptions and earlier paid tariff payments excluding the current payment. Add the pure bonus to purchased days before the existing Remnawave update/create. Store applied bonus in payment metadata as `firstPaidTrialBonusDays` for idempotent retries.

- [ ] **Step 6: Delete the duplicated balance activation branch**

After creating the PAID balance payment and debiting atomically, call:

```ts
const activation = await activateTariffByPaymentId(payment.id);
if (!activation.ok) return failBalancePayment(activation.status, activation.error);
```

Preserve existing refund, promo, referral, notification and response behavior. Remove direct calls to `createAdditionalSubscription`, `findConvertibleSubscription`, `extendSecondarySubscription`, and `consolidateToSingleSubscription` from this route.

- [ ] **Step 7: Make both trial routes reuse canonical UUID in single mode**

Legacy `/trial` and `/trials/:id/activate` must update the canonical Remnawave user and Subscription when one exists; only a first-ever trial creates a Remnawave user. Keep trial usage uniqueness and trial policy.

- [ ] **Step 8: Run GREEN**

Run: `cd backend && rtk npm test -- src/modules/subscription/canonical-activation.test.ts src/modules/client/balance-payment.contract.test.ts src/modules/tariff/trial-conversion.test.ts src/modules/tariff/tariff-activation.service.test.ts`

- [ ] **Step 9: Commit**

```bash
rtk git add backend/src/modules/tariff backend/src/modules/client backend/src/modules/subscription/canonical-activation.test.ts backend/src/scripts/seed-system-settings.ts
rtk git commit -m "feat: enforce canonical subscription activation"
```

### Task 3: Gifts, admin grants, and auto-renew use the canonical key

**Files:**
- Modify: `backend/src/modules/gift/gift.service.ts`
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Modify: `backend/src/modules/payment/auto-renew.cron.ts`
- Create: `backend/src/modules/gift/gift-single-mode.test.ts`
- Modify: `backend/src/modules/admin/client-admin-consistency.contract.test.ts`
- Create: `backend/src/modules/payment/auto-renew-single-mode.test.ts`

**Interfaces:**
- Gift redemption in single mode applies the reserved gift entitlement to the recipient canonical subscription, then lifecycle-deletes the reserve; it never replaces the recipient UUID.
- Admin grant/convert calls the same subscription activation functions as client payment.
- Auto-renew processes `Subscription[0]` only in single mode and does not also run the legacy Client loop.

- [ ] **Step 1: Write failing gift/admin/auto-renew tests**

Gift test fixtures contain recipient UUID `recipient-working-uuid` and reserve UUID `gift-reserve-uuid`. After redeem, assert the recipient UUID is patched and retained, reserve lifecycle deletion is requested, and no third UUID is created.

Admin test asserts conversion preview and apply target the same subscription id. Auto-renew test asserts one payment/charge when both legacy Client and Subscription fields are populated.

- [ ] **Step 2: Run RED**

Run: `cd backend && rtk npm test -- src/modules/gift/gift-single-mode.test.ts src/modules/admin/client-admin-consistency.contract.test.ts src/modules/payment/auto-renew-single-mode.test.ts`

- [ ] **Step 3: Implement gift merge**

Keep the existing atomic GiftCode ACTIVE -> REDEEMED claim. Under recipient client lock, if single mode and a canonical subscription exists, apply the gift's remaining paid days/tariff to that UUID, link the gift/payment audit metadata to the canonical subscription, then delete the reserve through `deleteSingleSubscription`. If no canonical subscription exists, transfer the reserve into index 0 without rotating its link.

- [ ] **Step 4: Route admin actions through shared preview/apply**

`grant-extend` and trial conversion must resolve the canonical subscription in single mode and use the conversion quote. Return `convertedDays`, `direction`, and `commissionPercent` in the admin response.

- [ ] **Step 5: Deduplicate auto-renew**

When single mode is false, skip the legacy Client auto-renew branch whenever the canonical Subscription exists, regardless of `autoRenewEnabled`; the Subscription record is the source of truth.

- [ ] **Step 6: Run GREEN and commit**

Run: `cd backend && rtk npm test -- src/modules/gift/gift-single-mode.test.ts src/modules/admin/client-admin-consistency.contract.test.ts src/modules/payment/auto-renew-single-mode.test.ts`

```bash
rtk git add backend/src/modules/gift backend/src/modules/admin backend/src/modules/payment
rtk git commit -m "feat: converge subscription lifecycle flows"
```

### Task 4: Secure six-hour subscription-link reissue

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260813000000_subscription_link_rotation/migration.sql`
- Create: `backend/src/modules/subscription/subscription-link-rotation.service.ts`
- Create: `backend/src/modules/subscription/subscription-link-rotation.service.test.ts`
- Modify: `backend/src/modules/client/client.routes.ts`
- Modify: `backend/src/modules/remna/remna.client.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `bot/src/api.ts`

**Interfaces:**
- Add nullable `Subscription.linkRotatedAt DateTime? @map("link_rotated_at")`.
- Produce `rotateSubscriptionLink({ clientId, subscriptionId, confirmed, ip }): RotationResult`.
- Route becomes canonical `POST /client/subscription/:id/reissue`; keep the old type route as a compatibility wrapper that resolves the same subscription.

- [ ] **Step 1: Write failing service tests**

Cover owner rejection, missing confirmation, successful revoke retaining UUID/expiry/tariff, second success within 6 hours returning 429 with `retryAt`, failed Remnawave revoke not updating `linkRotatedAt`, malformed/non-Lazeyka URL rejection, and two parallel calls producing one revoke.

- [ ] **Step 2: Run RED**

Run: `cd backend && rtk npm test -- src/modules/subscription/subscription-link-rotation.service.test.ts`

- [ ] **Step 3: Add migration and minimal service**

The migration only adds the nullable timestamp column; it does not touch UUIDs or existing subscription rows.

Within the client lock, require `confirmed === true`, compare `linkRotatedAt` with `now - 6h`, call `remnaRevokeUserSubscription(existingUuid)`, fetch fresh user, validate through `extractRemnaSubscriptionUrl`, extract/persist short UUID and success time, then write a `GiftEvent`/existing subscription audit event with `eventType="LINK_REISSUED"` and no full URL.

- [ ] **Step 4: Add a small IP burst limiter**

Apply the already-installed `express-rate-limit` to reissue only: 3 attempts/hour/IP. The durable six-hour account limit remains in the service/DB.

- [ ] **Step 5: Update API clients**

Both frontend and bot send `{ confirmed: true }` only after their confirmation UI. They render `retryAt` on 429.

- [ ] **Step 6: Run GREEN, Prisma validation, and commit**

Run: `cd backend && rtk npx prisma validate && rtk npm test -- src/modules/subscription/subscription-link-rotation.service.test.ts`

```bash
rtk git add backend/prisma backend/src/modules/subscription backend/src/modules/client/client.routes.ts backend/src/modules/remna/remna.client.ts frontend/src/lib/api.ts bot/src/api.ts
rtk git commit -m "feat: secure subscription link rotation"
```

### Task 5: Manual conversion and user/admin UI

**Files:**
- Modify: `backend/src/modules/client/client.routes.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/cabinet/pages/Tariffs.tsx`
- Modify: `frontend/src/cabinet/pages/Keys.tsx`
- Modify: `frontend/src/components/admin/subscription-remna-panel.tsx`
- Modify: `bot/src/api.ts`
- Modify: `bot/src/index.ts`
- Modify: `bot/src/keyboard.ts`
- Create: `backend/src/modules/client/manual-conversion.test.ts`
- Create: `frontend/scripts/single-subscription-conversion.test.mjs`
- Modify: `bot/src/subscription-access.test.ts`

**Interfaces:**
- `GET /client/tariff-conversion-preview` returns a quote token plus direction, commission, converted days and total paid days.
- `POST /client/tariff-conversion` accepts `{ tariffId, priceOptionId?, keepExtras, quoteToken }` and performs conversion without purchased days.
- Reissue UI always shows the site recommendation and destructive-link warning.

- [ ] **Step 1: Write failing backend/UI contract tests**

Manual conversion test asserts stale quote rejection, upgrade minimum-one-day rejection, successful conversion retains the exact UUID, and downgrade applies 5%. Frontend test asserts buttons/text: `Конвертация`, `Комиссия 5%`, `Оплатить ещё месяц`, and `Рекомендуем открыть обычный сайт`.

- [ ] **Step 2: Run RED**

Run: `cd backend && rtk npm test -- src/modules/client/manual-conversion.test.ts`

Run: `cd frontend && rtk node --test scripts/single-subscription-conversion.test.mjs`

- [ ] **Step 3: Implement quote token and manual apply**

Use an HMAC signed JSON payload with existing JWT secret containing subscription id, tariff id, price option id, source expiry/update timestamp, converted days and a 15-minute expiry. On POST, verify signature/expiry and source version under client lock; stale data returns 409 and requires a new preview.

- [ ] **Step 4: Update cabinet and admin UI**

Reuse the existing tariff modal styles/components. Show current/target tariff, remaining days, direction, 5% only for downgrade, rounding, converted days, and total after paid purchase. Manual upgrade success exposes the existing purchase action for another month.

In «Мои ключи», add reissue confirmation copy stating the old link/configurations stop working and recommend the normal website over mini-app.

- [ ] **Step 5: Update bot**

Expose conversion action and preview through the same endpoints. Keep no conversion math in bot code. Reissue confirmation includes the website recommendation.

- [ ] **Step 6: Run GREEN and builds**

Run: `cd backend && rtk npm test -- src/modules/client/manual-conversion.test.ts`

Run: `cd frontend && rtk node --test scripts/single-subscription-conversion.test.mjs && rtk npm run build`

Run: `cd bot && rtk npm test`

- [ ] **Step 7: Commit**

```bash
rtk git add backend/src/modules/client frontend/src bot/src
rtk git commit -m "feat: add subscription conversion controls"
```

### Task 6: Safe reversible duplicate cleanup

**Files:**
- Modify: `backend/src/scripts/migrate-composite-to-single.ts`
- Modify: `backend/src/scripts/migrate-composite-to-single.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Extend existing CLI with `--target-username <name>` and deterministic keep/delete decisions.
- Dry-run is the default; `--apply` is explicit.
- All deletion uses `deleteSingleSubscription`, never raw SQL or bulk username deletion.

- [ ] **Step 1: Write failing migration tests**

Fixtures:

```ts
const vssarovv = [expiredOldStandard, activeCurrentStandard];
const sallyqx = [activeStandard, activeOrdinaryVpn];
```

Assert dry-run performs zero writes/Remnawave calls; apply keeps `activeCurrentStandard.remnawaveUuid` for `vssarovv`; apply keeps `activeStandard.remnawaveUuid` and deletes only exact `Обычный ВПН` for `sallyqx`; duplicate usernames, missing exact tariff, unexpected counts or changed inventory block before deletion.

- [ ] **Step 2: Run RED**

Run: `cd backend && rtk npm test -- src/scripts/migrate-composite-to-single.test.ts`

- [ ] **Step 3: Implement exact planning and guarded apply**

Inventory records subscription id/index/tariff/UUID/short UUID/expiry/status and hashes the plan. Apply reloads inventory and requires the same hash. Clients with at most one active owned subscription are `unchanged` and receive no remote call.

The general cleanup keeps the active/current canonical UUID and lifecycle-deletes only proven duplicates. Target rules for `vssarovv` and `sallyqx` are explicit predicates, not substring matching.

- [ ] **Step 4: Run GREEN and dry-run locally**

Run: `cd backend && rtk npm test -- src/scripts/migrate-composite-to-single.test.ts`

Run: `cd backend && rtk npm run migrate:single-subscription -- --target-username vssarovv`

Run: `cd backend && rtk npm run migrate:single-subscription -- --target-username sallyqx`

Expected: dry-run report only. Do not use `--apply` until exact production inventory is reviewed.

- [ ] **Step 5: Commit**

```bash
rtk git add backend/src/scripts/migrate-composite-to-single.ts backend/src/scripts/migrate-composite-to-single.test.ts backend/package.json
rtk git commit -m "feat: guard single subscription cleanup"
```

### Task 7: Whole-flow regression and verification

**Files:**
- Create: `backend/src/modules/subscription/single-subscription-e2e.test.ts`
- Modify only production files required by failures found by this test.

**Interfaces:**
- One integration fixture drives trial -> paid -> manual conversion -> paid renewal -> admin grant -> auto-renew -> reissue and records every Remnawave UUID/short UUID.

- [ ] **Step 1: Write the failing whole-flow test**

Assert all pre-reissue operations use `originalUuid` and `originalShortUuid`; reissue retains `originalUuid`, changes short UUID once, and the immediate retry is 429. Toggle `multiSubscriptionsEnabled=true` in a separate fixture and assert a second subscription can be created again.

- [ ] **Step 2: Run RED and fix only integration gaps**

Run: `cd backend && rtk npm test -- src/modules/subscription/single-subscription-e2e.test.ts`

- [ ] **Step 3: Run complete verification**

Run: `cd backend && rtk npm test && rtk npm run build && rtk npx prisma validate`

Run: `cd bot && rtk npm test && rtk npm run build`

Run: `cd frontend && rtk node --test scripts/*.test.mjs && rtk npm run build`

Run: `rtk git diff --check`

- [ ] **Step 4: Confirm preservation evidence**

Record test output showing the UUID/link invariant, migration dry-run output for both named accounts, and `git diff` proving the link-rotation migration only adds a nullable timestamp.

- [ ] **Step 5: Commit**

```bash
rtk git add backend/src/modules/subscription/single-subscription-e2e.test.ts backend/src frontend/src bot/src
rtk git commit -m "test: verify single subscription lifecycle"
```

# Subscription Auto-Renewal Single-Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make canonical `Subscription` rows the renewal source of truth, prevent legacy double charges, and preserve safe retry behavior in single and multi modes.

**Architecture:** `processAutoRenewals` loads `multiSubscriptionsEnabled`, skips the legacy Client path whenever a canonical primary row exists, and lets `processSecondaryAutoRenewals` select the canonical rows. Single mode narrows that selection to index `0`; multi mode keeps all enabled subscriptions. Existing payment creation, `activateTariffByPaymentId`, retry detection, and balance compensation remain shared.

**Tech Stack:** TypeScript, Node test runner, Prisma, `tsx`.

## Global Constraints

- All changes are based on commit `4b6e759`.
- Existing `remnawaveUuid`, short UUID, and user subscription link never change; links change only through manual reissue.
- `multiSubscriptionsEnabled=false` means one subscription; `true` allows multiple subscriptions again.
- Do not add owner-only `UNIQUE` constraints.
- Write the failing test before production code.
- Do not run production cleanup with `--apply`.
- Run commands through `rtk`.
- Deliver a separate commit with changed files and test commands.

---

### Task 1: Add the failing auto-renewal contract test

**Files:**
- Create: `backend/src/modules/payment/auto-renew-single-mode.test.ts`

**Interfaces:**
- Consumes: the source of `backend/src/modules/payment/auto-renew.cron.ts` and the existing payment/activation contracts.
- Produces: executable assertions that fail against the current cron because canonical-primary ownership and single-mode selection are not enforced completely.

- [ ] **Step 1: Write the failing test**

Create a Node test file that reads the cron source and asserts the observable renewal contract through focused source-boundary checks. Include these independent tests:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./auto-renew.cron.ts", import.meta.url), "utf8");

test("canonical primary subscription owns renewal when legacy Client fields are also populated", () => {
  const legacy = source.slice(source.indexOf("const clients = await prisma.client.findMany"), source.indexOf("// обрабатываем индивидуальные автосписания"));
  assert.match(legacy, /ownerId_subscriptionIndex/);
  assert.match(legacy, /if \(primaryHasAutoRenew\?\.autoRenewEnabled === true \|\| primaryHasAutoRenew\?\.deletionRequestedAt\)/);
  assert.match(legacy, /autoRenewEnabled: true/);
  assert.match(legacy, /activateTariffByPaymentId\(paymentId\)/);
  assert.equal((legacy.match(/payment\.create/g) ?? []).length, 1);
});

test("single mode selects only Subscription[0] and respects each subscription toggle", () => {
  const subscriptionLoop = source.slice(source.indexOf("const secondaries = await prisma.subscription.findMany"));
  assert.match(source, /multiSubscriptionsEnabled/);
  assert.match(subscriptionLoop, /subscriptionIndex:\s*0/);
  assert.match(subscriptionLoop, /autoRenewEnabled:\s*true/);
});

test("multi mode keeps the existing individual-subscription renewal path", () => {
  const subscriptionLoop = source.slice(source.indexOf("const secondaries = await prisma.subscription.findMany"));
  assert.match(subscriptionLoop, /for \(const sec of secondaries\)/);
  assert.match(subscriptionLoop, /extendsSecondarySubId: sec\.id/);
  assert.match(subscriptionLoop, /activateTariffByPaymentId/);
});

test("renewal retries are idempotent and compensate balance on activation failure", () => {
  const subscriptionLoop = source.slice(source.indexOf("const secondaries = await prisma.subscription.findMany"));
  assert.match(subscriptionLoop, /recentYkPayment/);
  assert.match(subscriptionLoop, /retrying activation only/);
  assert.match(subscriptionLoop, /balance:\s*\{ increment: paidViaBalance \}/);
  assert.match(subscriptionLoop, /status: \"FAILED\"/);
});

test("auto-renew source never mutates canonical Remnawave identity or subscription URL", () => {
  const mutationSection = source.slice(source.indexOf("export async function processAutoRenewals"));
  assert.doesNotMatch(mutationSection, /remnawaveUuid:\s*null/);
  assert.doesNotMatch(mutationSection, /remnawaveUsername:/);
  assert.doesNotMatch(mutationSection, /subscriptionUrl/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
rtk npx tsx --test src/modules/payment/auto-renew-single-mode.test.ts
```

Expected: FAIL because the current canonical subscription query does not yet branch on `multiSubscriptionsEnabled` and the canonical path does not call `activateTariffByPaymentId`.

- [ ] **Step 3: Commit the RED test**

```bash
git add backend/src/modules/payment/auto-renew-single-mode.test.ts
git commit -m "test: cover canonical subscription auto-renew ownership"
```

### Task 2: Implement canonical ownership and mode selection

**Files:**
- Modify: `backend/src/modules/payment/auto-renew.cron.ts`

**Interfaces:**
- Consumes: `getSystemConfig().multiSubscriptionsEnabled`, existing canonical `Subscription` rows, existing payment and activation services.
- Produces: one canonical renewal flow per eligible subscription and legacy fallback only for clients with no primary subscription.

- [ ] **Step 1: Add the system-mode decision**

Read `multiSubscriptionsEnabled` once in `processAutoRenewals` and pass it to the canonical renewal function, preserving the default `true`:

```ts
const multiSubscriptionsEnabled = config.multiSubscriptionsEnabled ?? true;
...
await processSecondaryAutoRenewals(multiSubscriptionsEnabled);
```

- [ ] **Step 2: Make canonical primary existence the legacy guard**

In the legacy Client loop, query `Subscription[0]` by the existing compound key and skip the client whenever the row exists, not only when its toggle is enabled:

```ts
const primarySubscription = await prisma.subscription.findUnique({
  where: { ownerId_subscriptionIndex: { ownerId: client.id, subscriptionIndex: 0 } },
  select: { id: true, deletionRequestedAt: true },
});
if (primarySubscription) continue;
```

Keep the existing deletion-tombstone behavior and do not mutate any identity fields.

- [ ] **Step 3: Filter canonical subscriptions by mode**

Change the canonical function signature to accept `multiSubscriptionsEnabled`. Keep `autoRenewEnabled: true`, `deletionRequestedAt: null`, owner blocking, and tariff fallback. In single mode add `subscriptionIndex: 0`; in multi mode omit that filter:

```ts
async function processSecondaryAutoRenewals(multiSubscriptionsEnabled: boolean): Promise<void> {
  ...
  where: {
    autoRenewEnabled: true,
    ...(multiSubscriptionsEnabled ? {} : { subscriptionIndex: 0 }),
    deletionRequestedAt: null,
    ...
  }
}
```

- [ ] **Step 4: Use one committed Payment and one canonical activation**

For each canonical subscription, create one `Payment` with metadata containing `extendsSecondarySubId: sec.id`, then call `activateTariffByPaymentId(payment.id)` exactly once. Preserve the existing recent YooKassa retry branch as activation-only and keep balance restoration plus `FAILED` marking on activation failure. Do not change `remnawaveUuid`, short UUID, or subscription URL fields.

- [ ] **Step 5: Run the focused test to verify it passes**

Run:

```bash
cd backend
rtk npx tsx --test src/modules/payment/auto-renew-single-mode.test.ts
```

Expected: PASS.

### Task 3: Verify the branch and commit the implementation

**Files:**
- Modify: `backend/src/modules/payment/auto-renew.cron.ts`
- Test: `backend/src/modules/payment/auto-renew-single-mode.test.ts`

- [ ] **Step 1: Run the required TypeScript check**

```bash
cd backend
rtk npx tsc --noEmit --pretty false
```

Expected: exit code `0`.

- [ ] **Step 2: Review the diff and branch base**

```bash
rtk git diff --check
rtk git diff -- backend/src/modules/payment/auto-renew.cron.ts backend/src/modules/payment/auto-renew-single-mode.test.ts
rtk git merge-base HEAD 4b6e759
rtk git status --short --branch
```

Expected: only the owned files are changed after the design commits, no whitespace errors, and the merge-base is `4b6e759`.

- [ ] **Step 3: Commit the implementation**

```bash
git add backend/src/modules/payment/auto-renew.cron.ts backend/src/modules/payment/auto-renew-single-mode.test.ts
git commit -m "fix: make subscriptions the auto-renew source of truth"
```

- [ ] **Step 4: Re-run both requested commands after the commit**

```bash
cd backend
rtk npx tsx --test src/modules/payment/auto-renew-single-mode.test.ts
rtk npx tsc --noEmit --pretty false
```

Expected: both commands exit `0`.

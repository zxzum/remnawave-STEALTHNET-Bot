# Production Cabinet Frontend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Classic and Stealth client runtimes with the approved `cabinet-prototype` UI, connected to every production client flow, while preserving the administration panel and producing validated rollback archives.

**Architecture:** Keep the existing React 18/Vite application, router, authentication providers, API client, branding, PWA, backend, and admin routes. Copy the approved UI into `frontend/src/cabinet`, replace its mock store with a production adapter over `ClientAuthProvider` and `api`, statically import every client screen to preserve instant prototype transitions, then remove Classic/Stealth from the runtime graph.

**Tech Stack:** React 18, TypeScript 5.6, React Router 6, Tailwind CSS 4, Framer Motion 11, Radix UI, Node 22 built-in test runner, Express, Prisma, Vite 5.

## Global Constraints

- The approved `cabinet-prototype` JSX, CSS, responsive layout, Platega block, and `useOutlet` + `AnimatePresence mode="wait"` transitions are the visual source of truth.
- Do not redesign or upgrade the administration panel; remove only its obsolete Classic/Stealth selector.
- Client screens are eager imports in one client runtime; admin lazy imports remain unchanged.
- Skeletons appear only during initial data loading, never between client routes.
- Classic, Stealth, and prototype mock data must not be reachable from the Vite runtime graph.
- Prices, entitlements, payment availability, feature flags, and payment completion remain backend-authoritative.
- Preserve current production URLs, token refresh, Mini App auth, email verification, onboarding, payment return routes, PWA behavior, and floating support chat.
- Do not add a new state library, request library, router, design system, or payment abstraction.
- Preserve unrelated dirty-worktree files and commits.

---

## File Structure

- `frontend/src/cabinet/components/Layout.tsx` — approved responsive client shell and exact route-transition behavior.
- `frontend/src/cabinet/components/ui/CopyButton.tsx` — approved copy controls.
- `frontend/src/cabinet/components/ui/Toasts.tsx` — approved client toast presentation.
- `frontend/src/cabinet/pages/Auth.tsx` — approved login and registration shell connected to production auth states.
- `frontend/src/cabinet/pages/Cabinet.tsx` — subscriptions dashboard and Telegram-link prompt.
- `frontend/src/cabinet/pages/Keys.tsx` — production subscription links and application instructions.
- `frontend/src/cabinet/pages/Tariffs.tsx` — production tariffs, extra devices, promo, conversion, extension, and checkout.
- `frontend/src/cabinet/pages/Referrals.tsx` — production referral stats, sharing, and withdrawal.
- `frontend/src/cabinet/pages/Profile.tsx` — production profile, top-up, security, devices, payment history, and Telegram link.
- `frontend/src/cabinet/pages/OptionalServices.tsx` — feature-flagged overflow index.
- `frontend/src/cabinet/pages/CustomBuild.tsx`, `ExtraOptions.tsx`, `Proxy.tsx`, `Singbox.tsx`, `Gifts.tsx` — missing production features in the approved visual system.
- `frontend/src/cabinet/pages/AccountFlows.tsx` — forgot/reset/verify/link-email/onboarding/payment-wait/YooMoney route surfaces in the approved visual system.
- `frontend/src/cabinet/store/AppContext.tsx` — production-backed state shaped for the approved components.
- `frontend/src/cabinet/data/mock.ts` — temporary imported prototype fixture removed in Task 3 before runtime cutover.
- `frontend/src/cabinet/lib/cn.ts` — approved prototype class-merging helper.
- `frontend/src/cabinet/model.ts` — pure mapping and selection logic only.
- `frontend/src/cabinet/model.test.ts` — Node built-in behavioral tests.
- `frontend/src/cabinet/runtime.test.ts` — source-graph and route contract checks.
- `frontend/src/cabinet.css` — approved prototype CSS with its duplicate Tailwind import removed and all global/component selectors scoped under the temporary `body.cabinet-ui-active` class so the admin remains untouched and portalled dialogs retain their styles.
- `archive/client-designs/2026-07-22/` — two source archives, checksums, and restoration manifest; never imported by Vite.

---

### Task 1: Capture rollback backup, performance baseline, and old-design archives

**Files:**

- Create: `archive/client-designs/2026-07-22/classic.tar.gz`
- Create: `archive/client-designs/2026-07-22/stealth.tar.gz`
- Create: `archive/client-designs/2026-07-22/SHA256SUMS`
- Create: `archive/client-designs/2026-07-22/README.md`
- External: `/Users/sallyqx/Documents/projects/backups/stealthnet-cabinet-20260722-*/`

**Interfaces:**

- Produces a verified `repository.bundle`, `working-tree.tar.gz`, checksums, baseline build report, and independently restorable Classic/Stealth archives.
- Does not alter application source or database data.

- [ ] **Step 1: Record the exact pre-change state**

Run:

```bash
rtk git status --short --branch
rtk git rev-parse HEAD
rtk git submodule status
```

Expected: current branch/HEAD and all pre-existing dirty files are recorded in the task log.

- [ ] **Step 2: Create and validate the full local backup**

Run from the repository root:

```bash
BACKUP_DIR="$(mktemp -d /Users/sallyqx/Documents/projects/backups/stealthnet-cabinet-20260722-XXXXXX)"
printf '%s\n' "$BACKUP_DIR" > /tmp/stealthnet-cabinet-backup-path
rtk git bundle create "$BACKUP_DIR/repository.bundle" --all
tar -czf "$BACKUP_DIR/working-tree.tar.gz" \
  --exclude='.git' --exclude='node_modules' --exclude='*/node_modules' \
  --exclude='dist' --exclude='*/dist' --exclude='.codegraph' --exclude='.codebase-memory' .
chmod 700 "$BACKUP_DIR"
chmod 600 "$BACKUP_DIR/repository.bundle" "$BACKUP_DIR/working-tree.tar.gz"
rtk git bundle verify "$BACKUP_DIR/repository.bundle"
tar -tzf "$BACKUP_DIR/working-tree.tar.gz" >/dev/null
shasum -a 256 "$BACKUP_DIR/repository.bundle" "$BACKUP_DIR/working-tree.tar.gz" > "$BACKUP_DIR/SHA256SUMS"
```

Expected: bundle verification succeeds, tar listing exits 0, and both hashes are present. Record the resolved `BACKUP_DIR`; never rely on the shell variable in a later session.

- [ ] **Step 3: Capture the pre-migration frontend baseline**

Run:

```bash
rtk npm run build
BACKUP_DIR="$(sed -n '1p' /tmp/stealthnet-cabinet-backup-path)"
case "$BACKUP_DIR" in /Users/sallyqx/Documents/projects/backups/stealthnet-cabinet-20260722-*) ;; *) exit 1;; esac
find dist/assets -type f -maxdepth 1 -exec sh -c 'wc -c "$1"' _ {} \; | sort -n > "$BACKUP_DIR/frontend-assets-before.txt"
shasum -a 256 dist/assets/* > "$BACKUP_DIR/frontend-assets-before.sha256"
```

Working directory: `frontend`.

Expected: build exits 0 and the backup contains a byte-size inventory and hashes.

- [ ] **Step 4: Create separate Classic and Stealth source archives**

Run from the repository root:

```bash
mkdir -p archive/client-designs/2026-07-22
tar -czf archive/client-designs/2026-07-22/classic.tar.gz \
  --exclude='frontend/src/pages/cabinet/stealth' \
  frontend/src/pages/cabinet frontend/src/components/floating-chat.tsx \
  frontend/src/contexts/client-auth.tsx frontend/src/contexts/cabinet-config.tsx \
  frontend/src/lib/api.ts frontend/src/index.css
tar -czf archive/client-designs/2026-07-22/stealth.tar.gz \
  frontend/src/pages/cabinet/stealth frontend/src/components/stealth \
  frontend/src/lib/use-cabinet-design.ts frontend/src/index.css
shasum -a 256 archive/client-designs/2026-07-22/classic.tar.gz \
  archive/client-designs/2026-07-22/stealth.tar.gz \
  > archive/client-designs/2026-07-22/SHA256SUMS
tar -tzf archive/client-designs/2026-07-22/classic.tar.gz >/dev/null
tar -tzf archive/client-designs/2026-07-22/stealth.tar.gz >/dev/null
```

Expected: two non-empty archives list successfully and have separate checksums.

- [ ] **Step 5: Write the restoration manifest**

Create `README.md` with the exact archive scope, creation commit from Step 1, checksum command, and these restore commands:

```bash
shasum -a 256 -c SHA256SUMS
RESTORE_DIR="$(mktemp -d /tmp/stealthnet-client-designs-XXXXXX)"
tar -xzf classic.tar.gz -C "$RESTORE_DIR"
tar -xzf stealth.tar.gz -C "$RESTORE_DIR"
git clone repository.bundle restored-repository
tar -xzf working-tree.tar.gz -C restored-repository
```

- [ ] **Step 6: Verify and commit only the design archives**

Run:

```bash
rtk git diff --check -- archive/client-designs/2026-07-22
rtk git add archive/client-designs/2026-07-22
rtk git commit -m "chore: archive classic and stealth client designs"
```

Expected: commit contains only the two design archives, manifest, and checksums. The full backup remains outside Git.

### Task 2: Import the approved UI and establish failing runtime contracts

**Files:**

- Create: `frontend/src/cabinet/components/Layout.tsx`
- Create: `frontend/src/cabinet/components/ui/CopyButton.tsx`
- Create: `frontend/src/cabinet/components/ui/Toasts.tsx`
- Create: `frontend/src/cabinet/pages/Auth.tsx`
- Create: `frontend/src/cabinet/pages/Cabinet.tsx`
- Create: `frontend/src/cabinet/pages/Keys.tsx`
- Create: `frontend/src/cabinet/pages/Tariffs.tsx`
- Create: `frontend/src/cabinet/pages/Referrals.tsx`
- Create: `frontend/src/cabinet/pages/Profile.tsx`
- Create: `frontend/src/cabinet/store/AppContext.tsx`
- Create: `frontend/src/cabinet/data/mock.ts` (temporary fixture removed in Task 3)
- Create: `frontend/src/cabinet/lib/cn.ts`
- Create: `frontend/src/cabinet/model.ts`
- Create: `frontend/src/cabinet/model.test.ts`
- Create: `frontend/src/cabinet/runtime.test.ts`
- Create: `frontend/src/cabinet.css`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`

**Interfaces:**

- Produces `CabinetAppProvider`, `useApp`, `resolvePaymentUrl`, `shouldOfferTelegramLink`, `resolveOptionalNav`, and exact prototype UI files.
- Tests run through Node 22 without adding a test framework.

- [ ] **Step 1: Add the failing pure behavior tests**

Create `model.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { resolveOptionalNav, resolvePaymentUrl, shouldOfferTelegramLink } from "./model.ts";

test("prefers Crypto Bot Mini App URL only inside Telegram", () => {
  const urls = { miniAppPayUrl: "tg://pay", webAppPayUrl: "https://web/pay", payUrl: "https://fallback/pay" };
  assert.equal(resolvePaymentUrl(urls, true), "tg://pay");
  assert.equal(resolvePaymentUrl(urls, false), "https://web/pay");
});

test("offers Telegram linking only to authenticated unlinked clients", () => {
  assert.equal(shouldOfferTelegramLink({ id: "c1", telegramId: null }), true);
  assert.equal(shouldOfferTelegramLink({ id: "c1", telegramId: "123" }), false);
  assert.equal(shouldOfferTelegramLink(null), false);
});

test("shows overflow only for enabled optional services", () => {
  assert.deepEqual(resolveOptionalNav({ showProxyEnabled: true }), ["proxy"]);
  assert.deepEqual(resolveOptionalNav({}), []);
});
```

Add to `package.json`:

```json
"test:cabinet": "node --experimental-strip-types --test src/cabinet/*.test.ts"
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `rtk npm run test:cabinet`

Working directory: `frontend`.

Expected: FAIL because `model.ts` and runtime files do not exist.

- [ ] **Step 3: Add the minimum pure model**

Create `model.ts`:

```ts
export type PaymentUrls = {
  miniAppPayUrl?: string | null;
  webAppPayUrl?: string | null;
  payUrl?: string | null;
};

export function resolvePaymentUrl(urls: PaymentUrls, inTelegram: boolean): string | null {
  return (inTelegram ? urls.miniAppPayUrl : urls.webAppPayUrl) ?? urls.payUrl ?? urls.webAppPayUrl ?? null;
}

export function shouldOfferTelegramLink(client: { id: string; telegramId?: string | null } | null): boolean {
  return Boolean(client && !client.telegramId);
}

export function resolveOptionalNav(config: {
  customBuildConfig?: { enabled?: boolean } | null;
  sellOptionsEnabled?: boolean;
  showProxyEnabled?: boolean;
  showSingboxEnabled?: boolean;
  giftSubscriptionsEnabled?: boolean;
}): string[] {
  return [
    config.customBuildConfig?.enabled && "custom-build",
    config.sellOptionsEnabled && "extra-options",
    config.showProxyEnabled && "proxy",
    config.showSingboxEnabled && "singbox",
    config.giftSubscriptionsEnabled && "gifts",
  ].filter((value): value is string => Boolean(value));
}
```

- [ ] **Step 4: Mechanically import the approved presentation files**

Copy these files byte-for-byte before integration edits:

```bash
mkdir -p frontend/src/cabinet/components/ui frontend/src/cabinet/pages frontend/src/cabinet/store frontend/src/cabinet/data frontend/src/cabinet/lib
cp /Users/sallyqx/Documents/projects/cabinet-prototype/src/components/Layout.tsx frontend/src/cabinet/components/Layout.tsx
cp /Users/sallyqx/Documents/projects/cabinet-prototype/src/components/ui/CopyButton.tsx frontend/src/cabinet/components/ui/CopyButton.tsx
cp /Users/sallyqx/Documents/projects/cabinet-prototype/src/components/ui/Toasts.tsx frontend/src/cabinet/components/ui/Toasts.tsx
cp /Users/sallyqx/Documents/projects/cabinet-prototype/src/pages/{Auth,Cabinet,Keys,Tariffs,Referrals,Profile}.tsx frontend/src/cabinet/pages/
cp /Users/sallyqx/Documents/projects/cabinet-prototype/src/store/AppContext.tsx frontend/src/cabinet/store/AppContext.tsx
cp /Users/sallyqx/Documents/projects/cabinet-prototype/src/data/mock.ts frontend/src/cabinet/data/mock.ts
cp /Users/sallyqx/Documents/projects/cabinet-prototype/src/lib/cn.ts frontend/src/cabinet/lib/cn.ts
cp /Users/sallyqx/Documents/projects/cabinet-prototype/src/index.css frontend/src/cabinet.css
```

This is a mechanical import. Subsequent tasks remove all mock imports and connect handlers; do not alter approved class names or transition props.

Immediately isolate the imported stylesheet without changing presentation: remove its second `@import "tailwindcss"`, prefix its global and component selectors with `body.cabinet-ui-active`, and have both the authenticated `Layout` and unauthenticated `AuthShell` add that body class while mounted and remove it during cleanup. This body-level scope covers Radix portals while ensuring none of the new `body`, `.glass`, `.btn-primary`, selection, or scrollbar rules affect admin routes.

- [ ] **Step 5: Install only the missing UI primitive**

Run: `rtk npm install @radix-ui/react-accordion@1.2.17 --save`

Working directory: `frontend`.

Expected: package and lockfile change; React remains `18.3.1`, Router remains `6.28.0`, Vite remains `5.4.x`.

- [ ] **Step 6: Add the initial runtime source check**

Create `runtime.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("keeps the approved page transition", async () => {
  const layout = await readFile(new URL("./components/Layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /useOutlet\(\)/);
  assert.match(layout, /AnimatePresence mode="wait"/);
  assert.match(layout, /duration: 0\.28/);
});

test("isolates cabinet styles from admin while retaining portal styles", async () => {
  const layout = await readFile(new URL("./components/Layout.tsx", import.meta.url), "utf8");
  const auth = await readFile(new URL("./pages/Auth.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../cabinet.css", import.meta.url), "utf8");
  assert.match(layout, /cabinet-ui-active/);
  assert.match(auth, /cabinet-ui-active/);
  assert.doesNotMatch(css, /@import\s+["']tailwindcss["']/);
  assert.doesNotMatch(css, /(^|\n)body\s*\{/);
  assert.match(css, /body\.cabinet-ui-active/);
});
```

- [ ] **Step 7: Run tests and commit the imported baseline**

Run:

```bash
rtk npm run test:cabinet
rtk npx tsc -b tsconfig.app.json
rtk git diff --check -- frontend
rtk git add frontend/package.json frontend/package-lock.json frontend/src/cabinet
rtk git commit -m "feat: import approved cabinet interface"
```

Expected: pure model, transition, and CSS-isolation tests pass; TypeScript exits 0. The imported prototype is not reachable from `App.tsx` yet.

### Task 3: Replace prototype mocks with production cabinet data

**Files:**

- Modify: `frontend/src/cabinet/store/AppContext.tsx`
- Modify: `frontend/src/cabinet/pages/Cabinet.tsx`
- Modify: `frontend/src/cabinet/pages/Keys.tsx`
- Modify: `frontend/src/cabinet/pages/Referrals.tsx`
- Modify: `frontend/src/cabinet/components/Layout.tsx`
- Modify: `frontend/src/cabinet/model.ts`
- Modify: `frontend/src/cabinet/model.test.ts`
- Modify: `frontend/src/cabinet/runtime.test.ts`
- Delete: `frontend/src/cabinet/data/mock.ts`

**Interfaces:**

- Consumes `useClientAuth()`, `api.clientAllSubscriptions`, `api.getPublicSubscriptionPageConfig`, `api.getClientReferralStats`, `api.createWithdrawal`, `api.deleteClientDevice`, and `api.clientUpdateProfile`.
- Produces production-backed `CabinetAppProvider` state with no `data/mock` import.

- [ ] **Step 1: Add failing mapping tests for subscriptions and profile data**

Extend `model.test.ts` with literal API-shaped fixtures and assertions for:

```ts
const client = { id: "c1", email: "a@example.com", telegramId: "42", telegramUsername: "alice", balance: 1250 };
const subscription = { id: "s1", subscriptionIndex: 0, tariffName: "Premium", expireAt: "2026-08-22T00:00:00.000Z", trafficLimitBytes: 107374182400, trafficUsedBytes: 21474836480 };

assert.deepEqual(mapClient(client).email, "a@example.com");
assert.equal(mapSubscription(subscription, new Date("2026-07-22T00:00:00.000Z")).daysLeft, 31);
assert.equal(mapSubscription(subscription, new Date("2026-07-22T00:00:00.000Z")).trafficUsedGB, 20);
```

Extend `runtime.test.ts`:

```ts
test("contains no prototype mock imports", async () => {
  const files = ["Auth", "Cabinet", "Keys", "Tariffs", "Referrals", "Profile"];
  for (const file of files) {
    const source = await readFile(new URL(`./pages/${file}.tsx`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /data\/mock/);
  }
});
```

- [ ] **Step 2: Run the mapping tests and verify RED**

Run: `rtk npm run test:cabinet`

Expected: FAIL because `mapClient` and `mapSubscription` are absent.

- [ ] **Step 3: Implement pure mapping and the provider loader**

Add `mapClient` and `mapSubscription` to `model.ts`; use null-safe parsing, byte-to-GiB conversion (`bytes / 1024 ** 3`), and `Math.max(0, Math.ceil((expiry-now)/86400000))`.

Replace mock initialization in `CabinetAppProvider` with one guarded effect:

```tsx
const { state, refreshProfile, logout } = useClientAuth();
const token = state.token;

useEffect(() => {
  if (!token) return;
  const controller = new AbortController();
  setLoading(true);
  Promise.all([
    api.clientAllSubscriptions(token),
    api.getPublicConfig(),
    api.getPublicSubscriptionPageConfig(),
    api.getClientReferralStats(token),
  ]).then(([subscriptions, config, subscriptionPage, referrals]) => {
    if (controller.signal.aborted) return;
    setState({ client: mapClient(state.client), subscriptions: mapSubscriptions(subscriptions), config, subscriptionPage, referrals });
  }).catch((error) => {
    if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Не удалось загрузить кабинет");
  }).finally(() => {
    if (!controller.signal.aborted) setLoading(false);
  });
  return () => controller.abort();
}, [token, state.client?.id]);
```

Keep `copy`, `toast`, and `dismissToast` local UI helpers. Make mutation methods call existing API methods and refresh only affected data.

Delete `frontend/src/cabinet/data/mock.ts` after all prototype fixture imports have been replaced.

- [ ] **Step 4: Wire Dashboard, Keys, Referrals, and shell controls**

Use provider data in the approved JSX. Replace prototype IDs, keys, referral URLs, device deletion, withdrawal, language/currency saving, logout, brand name, and avatar values with backend values. Preserve all existing classes, animation props, DOM order, and mobile/desktop breakpoints.

- [ ] **Step 5: Run tests, typecheck, and commit**

Run:

```bash
rtk npm run test:cabinet
rtk npx tsc -b tsconfig.app.json
rtk git diff --check -- frontend/src/cabinet
rtk git add frontend/src/cabinet
rtk git commit -m "feat: connect cabinet data and subscriptions"
```

Expected: mapping and no-mock tests pass; TypeScript exits 0.

### Task 4: Connect authentication, onboarding, recovery, and Telegram linking

**Files:**

- Modify: `frontend/src/cabinet/pages/Auth.tsx`
- Modify: `frontend/src/cabinet/pages/Cabinet.tsx`
- Modify: `frontend/src/cabinet/pages/Profile.tsx`
- Create: `frontend/src/cabinet/pages/AccountFlows.tsx`
- Modify: `frontend/src/cabinet/store/AppContext.tsx`
- Modify: `frontend/src/cabinet/runtime.test.ts`

**Interfaces:**

- Consumes all existing methods exposed by `useClientAuth` plus `clientForgotPassword`, `clientResetPassword`, `clientVerifyEmail`, `clientVerifyLinkEmail`, `client2FASetup`, `client2FAConfirm`, `client2FADisable`, `clientSetPassword`, `clientCompleteOnboarding`, `clientLinkTelegramRequest`, and `clientLinkTelegram`.
- Produces eager exports for all existing client auth/account routes.

- [ ] **Step 1: Add failing route and Telegram-link tests**

Extend `runtime.test.ts` to assert that the route export file includes login, register, forgot, reset, verify-email, verify-link-email, onboarding, payment-wait, and YooMoney screens, and that both Cabinet and Profile invoke the shared Telegram-link action.

- [ ] **Step 2: Verify RED**

Run: `rtk npm run test:cabinet`

Expected: FAIL because `AccountFlows.tsx` and the shared Telegram-link handler are absent.

- [ ] **Step 3: Replace prototype auth timers and fake QR**

Keep the approved Auth JSX but bind each step to real provider state:

```tsx
const { login, register, submit2FACode, state } = useClientAuth();
await register({ email, password, preferredLang, preferredCurrency });
await login(email, password);
if (state.pending2FAToken) await submit2FACode(code);
```

Render the real `client2FASetup()` secret and QR URI; never retain `TOTP_KEY` or `FakeQr`. Route email verification through its token page, and honor `skipEmailVerification`, `onboardingEmailRequired`, and `onboarding2faEnabled` from public config.

- [ ] **Step 4: Implement remaining account route surfaces**

Move the current production request/error logic from the archived account pages into `AccountFlows.tsx`, wrapping it in the approved `AuthShell`, input, button, dialog, toast, and skeleton classes. Keep exact production URL/query parameter names.

- [ ] **Step 5: Connect Telegram linking in Cabinet and Profile**

Use one provider action:

```ts
async function linkTelegram() {
  if (!token) return;
  const request = await api.clientLinkTelegramRequest(token);
  if (inTelegram && window.Telegram?.WebApp?.initData) {
    await api.clientLinkTelegram(token, { initData: window.Telegram.WebApp.initData });
    await refreshProfile();
    return;
  }
  if (!request.botUsername) throw new Error("Telegram-бот для привязки не настроен");
  openExternal(`https://t.me/${request.botUsername}?start=link_${request.code}`);
}
```

Use the approved `BindTelegramDialog` after email registration and the same action in Profile when `shouldOfferTelegramLink(state.client)` is true. The existing request returns `{ code, expiresAt, botUsername }`; display expiry/error state and do not invent a second endpoint.

- [ ] **Step 6: Run tests, typecheck, and commit**

Run:

```bash
rtk npm run test:cabinet
rtk npx tsc -b tsconfig.app.json
rtk git add frontend/src/cabinet
rtk git commit -m "feat: connect cabinet authentication flows"
```

Expected: all account-route and Telegram-link tests pass; TypeScript exits 0.

### Task 5: Connect tariffs, extra devices, Platega, Crypto Bot, and balance

**Files:**

- Modify: `frontend/src/cabinet/pages/Tariffs.tsx`
- Modify: `frontend/src/cabinet/store/AppContext.tsx`
- Modify: `frontend/src/cabinet/model.ts`
- Modify: `frontend/src/cabinet/model.test.ts`
- Reuse: `frontend/src/components/payment/pay-now-panel.tsx`
- Reuse: `frontend/src/lib/open-payment-url.ts`

**Interfaces:**

- Consumes current public tariff/config responses and payment methods: `clientTariffConversionPreview`, `clientCheckPromoCode`, `clientActivatePromoCode`, `clientPayByBalance`, `clientCreatePlategaPayment`, `cryptopayCreatePayment`, and `/cabinet/payment-wait`.
- Produces real checkout actions without changing the approved Platega markup or trusting displayed totals.

- [ ] **Step 1: Add failing payment payload tests**

Add fixtures covering new purchase, extension, conversion, extra devices, promo, Platega method ID, and Crypto Bot URL selection. Assert the pure builder emits only tariff/option IDs and selection fields; it must not emit an authoritative `amount` for tariff purchase.

- [ ] **Step 2: Verify RED**

Run: `rtk npm run test:cabinet`

Expected: FAIL because `buildTariffPurchase` is absent.

- [ ] **Step 3: Implement the minimum purchase mapper**

Add a typed `buildTariffPurchase(selection)` returning:

```ts
{
  tariffId,
  tariffPriceOptionId,
  deviceCount,
  promoCode: promoCode || undefined,
  extendsSecondarySubId,
  asAdditional,
  removeExtrasOnActivate,
}
```

Reuse current extension/conversion rules from `client-tariffs.tsx`; do not duplicate server pricing.

- [ ] **Step 4: Replace prototype tariff constants with backend tariffs**

Map `getPublicTariffs()` categories and price options into the approved tariff rows. Keep the duration cards, device cards, agreement, renewal notice, summary, payment step, and every class/animation in place. Display server-returned price/discount/currency and preview results.

- [ ] **Step 5: Wire the exact approved payment buttons**

- Orange balance button calls `clientPayByBalance(token, payload)`.
- Platega СБП/card/crypto buttons keep their current markup and call `clientCreatePlategaPayment(token, { ...payload, paymentMethod: method.id })` using server-enabled IDs.
- Crypto Bot calls `cryptopayCreatePayment(token, payload)` and `resolvePaymentUrl(result, inTelegram)`.
- Successful external creation renders the existing `PayNowPanel`; its paid action navigates to `/cabinet/payment-wait?id=<id>&kind=tariff`.
- Disable the initiating control while pending and render the backend error in the approved dialog.

- [ ] **Step 6: Run tests, typecheck, and commit**

Run:

```bash
rtk npm run test:cabinet
rtk npx tsc -b tsconfig.app.json
rtk git diff --check -- frontend/src/cabinet/pages/Tariffs.tsx
rtk git add frontend/src/cabinet
rtk git commit -m "feat: connect cabinet tariff payments"
```

Expected: payment mapping tests and TypeScript pass.

### Task 6: Connect profile, top-up, devices, security, and history

**Files:**

- Modify: `frontend/src/cabinet/pages/Profile.tsx`
- Modify: `frontend/src/cabinet/store/AppContext.tsx`
- Modify: `frontend/src/cabinet/model.test.ts`

**Interfaces:**

- Consumes `clientPayments`, `getMyAllDevices`, `deleteClientDevice`, configured payment-provider methods, `clientCreatePlategaPayment`, `cryptopayCreatePayment`, `clientChangePassword`, `clientSetPassword`, `clientLinkEmailRequest`, `client2FASetup`, `client2FAConfirm`, `client2FADisable`, and `yookassaUnlinkPaymentMethod`.
- Produces real Profile interactions while preserving BankCard, TopUp, AccountData, Security, and PaymentsHistory components.

- [ ] **Step 1: Add failing validation tests**

Test that top-up rejects non-finite, zero, negative, and below-provider-minimum values; test device deletion payload includes the correct subscription type/id; test payment history mapping preserves backend status and timestamp.

- [ ] **Step 2: Verify RED**

Run: `rtk npm run test:cabinet`

Expected: FAIL on missing validation/mapping functions.

- [ ] **Step 3: Implement pure validation/mapping and connect handlers**

Keep native `<input type="number" min={...}>`, but validate again before the request. Replace prototype balance mutation with configured provider creation and `PayNowPanel`. Refresh profile/payments only after backend confirmation; never increment balance in local state.

- [ ] **Step 4: Connect security and device operations**

Use real 2FA setup/confirm/disable dialogs, password change/set flows, email linking, Telegram linking, device list/deletion, and payment-method unlinking. Pending actions disable only the relevant control and preserve current focus/dialog behavior.

- [ ] **Step 5: Run tests, typecheck, and commit**

Run:

```bash
rtk npm run test:cabinet
rtk npx tsc -b tsconfig.app.json
rtk git add frontend/src/cabinet
rtk git commit -m "feat: connect cabinet profile operations"
```

Expected: validation tests and TypeScript pass.

### Task 7: Add feature-flagged optional screens and support

**Files:**

- Create: `frontend/src/cabinet/pages/OptionalServices.tsx`
- Create: `frontend/src/cabinet/pages/CustomBuild.tsx`
- Create: `frontend/src/cabinet/pages/ExtraOptions.tsx`
- Create: `frontend/src/cabinet/pages/Proxy.tsx`
- Create: `frontend/src/cabinet/pages/Singbox.tsx`
- Create: `frontend/src/cabinet/pages/Gifts.tsx`
- Modify: `frontend/src/cabinet/components/Layout.tsx`
- Reuse: `frontend/src/components/floating-chat.tsx`
- Modify: `frontend/src/cabinet/runtime.test.ts`

**Interfaces:**

- Consumes existing optional-feature API functions and `resolveOptionalNav(config)`.
- Produces a compact “Ещё” overflow entry only when optional features are enabled.

- [ ] **Step 1: Add failing feature-flag route tests**

Assert every optional route is present, no disabled route appears in `resolveOptionalNav`, the five primary navigation entries remain unchanged/in order, and `FloatingChat` is mounted once in the authenticated shell.

- [ ] **Step 2: Verify RED**

Run: `rtk npm run test:cabinet`

Expected: FAIL because optional screens and overflow entry are absent.

- [ ] **Step 3: Port existing production behavior into new visual surfaces**

Move the request, validation, payment, clipboard, empty/error, and result logic from the archived production pages into the new files. Use only approved design tokens and existing component families (`glass`, `glass-inset`, `rounded-4xl`, `btn-primary`, `btn-ghost`, prototype dialogs/toasts); do not re-import old page components.

- [ ] **Step 4: Add conditional overflow navigation**

Keep Cabinet, Keys, Tariffs, Referrals, and Profile unchanged. Render “Ещё” only when `resolveOptionalNav(config).length > 0`; list only enabled routes and preserve mobile safe-area/touch-target rules.

- [ ] **Step 5: Mount support once**

Mount the existing `FloatingChat` in the authenticated new shell and pass the existing client token/config. Verify ticket list, create, reply, attachments, unread count, and AI tab continue using their current APIs.

- [ ] **Step 6: Run tests, typecheck, and commit**

Run:

```bash
rtk npm run test:cabinet
rtk npx tsc -b tsconfig.app.json
rtk git add frontend/src/cabinet
rtk git commit -m "feat: add optional cabinet services"
```

Expected: optional navigation/support tests and TypeScript pass.

### Task 8: Cut over routes, remove runtime design selection, and preserve admin

**Files:**

- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/pages/settings.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/public-bootstrap.ts`
- Modify: `backend/src/modules/client/client.service.ts`
- Modify: `backend/src/modules/branding/spa-html.ts`
- Delete: `frontend/src/lib/use-cabinet-design.ts`
- Delete: `frontend/src/components/stealth/`
- Delete/replace archived runtime files under: `frontend/src/pages/cabinet/`
- Modify: `frontend/src/cabinet/runtime.test.ts`

**Interfaces:**

- Produces one eager client UI route graph and retains admin lazy imports.
- Removes Classic/Stealth selection from admin UI and public client runtime while leaving database rows untouched.

- [ ] **Step 1: Add failing cutover assertions**

Extend `runtime.test.ts`:

```ts
test("client routes are eager and legacy design selection is absent", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /lazy\(\(\) => import\("@\/pages\/cabinet/);
  assert.match(app, /from "@\/cabinet\/pages/);
  assert.doesNotMatch(app, /useCabinetDesign|Classic|Stealth/);
});
```

Add source checks that `settings.tsx` has no design selector, public bootstrap/API types have no `cabinetDesign`, and archived paths are absent from imports.

- [ ] **Step 2: Verify RED**

Run: `rtk npm run test:cabinet`

Expected: FAIL against current lazy client imports and design-selection fields.

- [ ] **Step 3: Statically import all client screens**

Replace only client `lazy()` declarations with static imports from `@/cabinet/pages/*`. Keep every admin declaration using `lazy()`. Preserve the current route URLs and guards, wrap the client route tree in `ClientAuthProvider` and `CabinetAppProvider`, and import `./cabinet.css` from `main.tsx`.

- [ ] **Step 4: Remove the obsolete admin selector only**

Delete the Classic/Stealth cards and browser-application switch from `settings.tsx`, omit their fields from the save payload and frontend admin/public types, and remove the corresponding public bootstrap fields. Do not change any other setting control, backend admin route, or persisted database field; retaining backend read/write compatibility keeps rollback safe.

- [ ] **Step 5: Stop emitting client design flags**

Remove `cabinetDesign` and `cabinetDesignApplyInBrowser` from the public config projection and SPA bootstrap. Keep existing database rows and admin read compatibility; do not run a migration or delete settings.

- [ ] **Step 6: Delete archived runtime sources and check imports**

After `rtk rg` proves no new code imports them, delete `components/stealth`, `use-cabinet-design.ts`, and replaced Classic/Stealth client presentation files. Retain shared production helpers such as `PayNowPanel`, `FloatingChat`, auth context, API client, and open-payment utilities.

- [ ] **Step 7: Run full tests/builds and commit**

Run:

```bash
rtk npm run test:cabinet
rtk npm run build
rtk git diff --check
```

Working directory: `frontend`.

Then run in `backend`:

```bash
rtk npm run build
```

Expected: cabinet tests pass, both builds exit 0, and no whitespace errors exist.

Commit:

```bash
rtk git add frontend/src/App.tsx frontend/src/main.tsx frontend/src/cabinet frontend/src/pages/settings.tsx frontend/src/pages/cabinet frontend/src/components/stealth frontend/src/lib/use-cabinet-design.ts frontend/src/lib/api.ts frontend/src/lib/public-bootstrap.ts backend/src/modules/client/client.service.ts backend/src/modules/branding/spa-html.ts frontend/package.json frontend/package-lock.json
rtk git commit -m "feat: cut over to the new client cabinet"
```

### Task 9: Browser fidelity, security, and performance verification

**Files:**

- Modify only files with defects found by verification.
- Update: `archive/client-designs/2026-07-22/README.md` only if restoration verification reveals an incorrect command.

**Interfaces:**

- Consumes the approved prototype at `/Users/sallyqx/Documents/projects/cabinet-prototype` and the production build.
- Produces fresh evidence for functional, visual, security, archive, and performance acceptance.

- [ ] **Step 1: Run the complete automated verification**

Run:

```bash
rtk npm run test:cabinet
rtk npm run build
rtk git diff --check
rtk rg -n 'useCabinetDesign|ClassicDashboardPage|ClassicProfilePage|StealthDashboard|data/mock' frontend/src
```

Working directory: `frontend`. Then run `rtk npm run build` separately in `backend`.

Expected: tests and both builds exit 0; the final search returns no client runtime references to old designs or mock data.

- [ ] **Step 2: Compare build output to the baseline**

Run in `frontend` using the resolved backup directory recorded in Task 1:

```bash
find dist/assets -type f -maxdepth 1 -exec sh -c 'wc -c "$1"' _ {} \; | sort -n > /tmp/frontend-assets-after.txt
BACKUP_DIR="$(sed -n '1p' /tmp/stealthnet-cabinet-backup-path)"
case "$BACKUP_DIR" in /Users/sallyqx/Documents/projects/backups/stealthnet-cabinet-20260722-*) ;; *) exit 1;; esac
diff -u "$BACKUP_DIR/frontend-assets-before.txt" /tmp/frontend-assets-after.txt || true
```

Expected: admin chunks remain lazy; client navigation has no client-route dynamic imports; initial transferred JavaScript does not exceed the pre-migration baseline. If it does, inspect the Vite graph and remove only unused client code/dependencies without reintroducing lazy client navigation.

- [ ] **Step 3: Start the production frontend and backend locally**

Run the repository's existing development commands in separate sessions. Use Browser/IAB against the local URL and preserve the existing API proxy configuration.

- [ ] **Step 4: Verify visual fidelity at three viewports**

Check desktop `1440×900`, phone `390×844`, and Telegram Mini App-sized `390×700`. Compare the prototype and integrated app for layout, copy, typography, palette, radii, Platega markup, mobile safe area, and the exact fade/vertical route transition. Capture screenshots and inspect both the reference and latest implementation with `view_image`.

- [ ] **Step 5: Verify complete client behavior**

Exercise login, registration, email verification, password recovery, 2FA, Mini App auth, onboarding, logout, five primary screens, Telegram linking now/later, device deletion, referral withdrawal, every enabled optional screen, support tickets/attachments, tariff selection, extra devices, promo, balance, Platega, Crypto Bot, top-up, and payment-wait. Use configured test/sandbox providers or stop before external confirmation so no unintended real charge occurs.

- [ ] **Step 6: Verify request and error behavior**

Confirm one public-config request, parallel initial data requests, no refetch on ordinary route transitions, button locking during mutations, backend errors in the approved surface, no archived-design fallback, and no secrets/payment credentials in browser responses or bundle text.

- [ ] **Step 7: Revalidate backup artifacts**

Run:

```bash
BACKUP_DIR="$(sed -n '1p' /tmp/stealthnet-cabinet-backup-path)"
case "$BACKUP_DIR" in /Users/sallyqx/Documents/projects/backups/stealthnet-cabinet-20260722-*) ;; *) exit 1;; esac
shasum -a 256 -c archive/client-designs/2026-07-22/SHA256SUMS
tar -tzf archive/client-designs/2026-07-22/classic.tar.gz >/dev/null
tar -tzf archive/client-designs/2026-07-22/stealth.tar.gz >/dev/null
shasum -a 256 -c "$BACKUP_DIR/SHA256SUMS"
rtk git bundle verify "$BACKUP_DIR/repository.bundle"
```

Expected: all checksums and bundle verification pass.

- [ ] **Step 8: Commit only verification fixes**

Run:

```bash
rtk git status --short
rtk git diff --check
rtk git add frontend/src/cabinet frontend/src/App.tsx frontend/src/main.tsx frontend/src/pages/settings.tsx frontend/src/pages/cabinet frontend/src/components/stealth frontend/src/lib/use-cabinet-design.ts frontend/src/lib/api.ts frontend/src/lib/public-bootstrap.ts frontend/package.json frontend/package-lock.json backend/src/modules/client/client.service.ts backend/src/modules/branding/spa-html.ts archive/client-designs/2026-07-22/README.md
rtk git commit -m "test: verify production cabinet migration"
```

Skip the commit if verification required no source changes. Never stage the pre-existing `.DS_Store`, `.codegraph`, `.superpowers`, or unrelated plan file.

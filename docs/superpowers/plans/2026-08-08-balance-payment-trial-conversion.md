# Оплата с баланса и конвертация trial — Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Сделать оплату с баланса однократной для mini-app, показывать spinner/disabled на всех пользовательских payment actions и переводить trial-подписку на новый тариф в той же подписке с прежней ссылкой.

**Architecture:** Общий frontend helper clientPayByBalance будет single-flight для одинаковой операции, а существующие локальные состояния payLoading, paying и loading будут управлять видимым состоянием кнопок. Backend сохранит атомарное списание, создаст Payment до активации и компенсирует debit при ошибке. findConvertibleSubscription сначала выбирает разрешённый trial, после чего существующий extendSecondarySubscription обновляет ту же строку и Remnawave UUID.

**Tech Stack:** TypeScript, React 18, Vite, lucide-react, Node 22 native test runner, Express, Prisma, Remnawave API.

## Global Constraints

- Продукт и пользовательские тексты называют **Лазейка ВПН**; legacy-технические имена stealthnet не переименовываются.
- Новые зависимости, database migration, новый endpoint и новый payment orchestration service не добавляются.
- disabled и spinner должны действовать до завершения именно того Promise, который выполняет оплату или создаёт внешний payment.
- Успешный ответ backend не переопределяется ошибкой best-effort refresh/reload после оплаты.
- Trial → premium сохраняет существующие Subscription.id и remnawaveUuid; меняются tariffId, trialId и entitlement.

---

### Task 1: Защитить общий balance API от параллельных вызовов

**Files:**

- Modify: frontend/src/lib/api.ts:2267-2279
- Create: frontend/scripts/client-pay-by-balance.test.ts

**Interfaces:**

- Consumes: существующий api.clientPayByBalance(token, data) и request<T>().
- Produces: тот же публичный метод и тот же response type; для одинаковых token + JSON.stringify(data) использует один in-flight request.

- [ ] Step 1: Write the failing test

Создать native Node test без новой зависимости. Он должен задержать один mock fetch, вызвать helper дважды до его завершения и проверить, что сетевой вызов один:

    import assert from "node:assert/strict";
    import test from "node:test";
    import { api } from "../src/lib/api.ts";

    test("parallel balance payments with the same payload share one request", async () => {
      const originalFetch = globalThis.fetch;
      const expected = { message: "ok", paymentId: "payment-1", newBalance: 1640 };
      let calls = 0;
      let release: (() => void) | undefined;

      globalThis.fetch = async () => {
        calls += 1;
        await new Promise<void>((resolve) => { release = resolve; });
        return new Response(JSON.stringify(expected), { status: 200 });
      };

      try {
        const payload = { tariffId: "tariff-1", tariffPriceOptionId: "price-1" };
        const first = api.clientPayByBalance("client-token", payload);
        const second = api.clientPayByBalance("client-token", payload);

        await Promise.resolve();
        assert.equal(calls, 1);
        assert.ok(release);
        release();
        assert.deepEqual(await Promise.all([first, second]), [expected, expected]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

- [ ] Step 2: Run the test and verify it fails

Run from frontend:

    rtk node --experimental-strip-types --test scripts/client-pay-by-balance.test.ts

Expected: FAIL on assert.equal(calls, 1), because the current method calls request independently for both invocations.

- [ ] Step 3: Implement the minimal single-flight map

Перед api объявить map с конкретным результатом balance payment:

    type ClientBalancePayment = { message: string; paymentId: string; newBalance: number };
    const balancePaymentInFlight = new Map<string, Promise<ClientBalancePayment>>();

В clientPayByBalance использовать ключ операции и удалять его только после завершения:

    const key = token + ":" + JSON.stringify(data);
    const inFlight = balancePaymentInFlight.get(key);
    if (inFlight) return inFlight;

    const payment = request<ClientBalancePayment>("/client/payments/balance", {
      method: "POST",
      body: JSON.stringify(data),
      token,
    });
    balancePaymentInFlight.set(key, payment);
    return payment.finally(() => {
      if (balancePaymentInFlight.get(key) === payment) balancePaymentInFlight.delete(key);
    });

- [ ] Step 4: Run the focused test and verify it passes

Run the same node test. Expected: PASS with exactly one mock network call and two equal successful results.

- [ ] Step 5: Commit the API guard

    rtk git add frontend/src/lib/api.ts frontend/scripts/client-pay-by-balance.test.ts
    rtk git commit -m "fix: coalesce duplicate client balance payments"

### Task 2: Довести loading/disabled UX до всех пользовательских payment actions

**Files:**

- Modify: frontend/src/cabinet/pages/Tariffs.tsx:13-24,217-232,606-690
- Modify: frontend/src/components/payment/extend-subscription-dialog.tsx:163-211,350-385
- Modify: frontend/src/cabinet/pages/Services.tsx:1-12,36-91
- Modify: frontend/src/pages/cabinet/client-tariffs.tsx:497-522
- Modify: frontend/src/pages/cabinet/client-proxy.tsx:139-155
- Modify: frontend/src/pages/cabinet/client-singbox.tsx:135-151
- Modify: frontend/src/pages/cabinet/client-custom-build.tsx:74-93

**Interfaces:**

- Consumes: существующие state flags paying, payLoading и loading и уже подключённые payment handlers.
- Produces: каждая кнопка оплаты становится disabled сразу после клика, показывает Loader2 animate-spin до завершения запроса и не показывает ошибку из post-payment refresh после успешного debit.

- [ ] Step 1: Write the failing UI contract test

Создать frontend/scripts/payment-loading.contract.test.ts. Проверка читает исходники и падает для дыр в Tariffs, Services и provider buttons в extend dialog:

    import assert from "node:assert/strict";
    import test from "node:test";
    import { readFile } from "node:fs/promises";

    test("payment actions expose loading state", async () => {
      const files = [
        "src/cabinet/pages/Tariffs.tsx",
        "src/components/payment/extend-subscription-dialog.tsx",
        "src/cabinet/pages/Services.tsx",
      ];
      for (const file of files) {
        const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
        assert.match(source, /disabled=\{(?:paying|payLoading|loading)/, file);
        assert.match(source, /Loader2[\s\S]*animate-spin/, file);
      }
    });

- [ ] Step 2: Run the focused UI contract test and verify it fails

Run from frontend:

    rtk node --experimental-strip-types --test scripts/payment-loading.contract.test.ts

Expected: FAIL because Tariffs.tsx and Services.tsx do not currently import/render Loader2, and extend provider buttons do not show the spinner.

- [ ] Step 3: Add spinner rendering while preserving existing state guards

Use the already installed lucide-react icon. Add Loader2 to Tariffs.tsx and Services.tsx; do not create a new loading component. Apply the existing flags:

    <button disabled={paying} onClick={payBalance}>
      {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wallet className="h-5 w-5" />}
      <span>{paying ? "Оплата…" : "Оплатить с баланса"}</span>
    </button>

Use the same conditional icon for Platega/provider buttons in PlanDialog and ExtendSubscriptionDialog; keep every existing disabled={paying || ...} or disabled={payLoading || ...} condition. In CheckoutActions, use loading for balance, Platega and Crypto Bot buttons. Existing client-tariffs, proxy, Sing-box and custom-build buttons already have most of this pattern; only fill missing labels/guards and keep their current styling.

- [ ] Step 4: Finalize successful balance UI before best-effort refreshes

В каждом balance handler не держать success flow внутри try-блока, который ждёт profile/slot reload после успешной оплаты. Например, CheckoutActions.finishBalance должен toast success сразу после balancePay:

    const result = await balancePay();
    toast({ title: result.message, variant: "success" });
    void Promise.all([refreshProfile(), reload()]).catch(() => undefined);

Apply the same ordering to PlanDialog.payBalance, client-tariffs.payByBalance, proxy, Sing-box, custom-build and extend-dialog balance flows. Keep finally so the spinner is cleared after the operation.

- [ ] Step 5: Run focused UI test and frontend build

    rtk node --experimental-strip-types --test scripts/payment-loading.contract.test.ts
    rtk npm run build

Expected: contract test PASS and Vite/TypeScript build PASS.

- [ ] Step 6: Commit the payment button UX

    rtk git add frontend/src/cabinet/pages/Tariffs.tsx frontend/src/components/payment/extend-subscription-dialog.tsx frontend/src/cabinet/pages/Services.tsx frontend/src/pages/cabinet/client-tariffs.tsx frontend/src/pages/cabinet/client-proxy.tsx frontend/src/pages/cabinet/client-singbox.tsx frontend/src/pages/cabinet/client-custom-build.tsx frontend/scripts/payment-loading.contract.test.ts
    rtk git commit -m "fix: show loading state during client payments"

### Task 3: Исправить выбор trial-кандидата и сохранить UUID при конвертации

**Files:**

- Modify: backend/src/modules/tariff/tariff-activation.service.ts:714-966,979-1055
- Modify: backend/src/modules/tariff/tariff-activation.service.test.ts:25-59
- Modify: backend/src/modules/tariff/tariff-activation-ownership.test.ts:42-73
- Modify: backend/src/modules/tariff/trial-conversion.test.ts:1-43

**Interfaces:**

- Consumes: trialAllowsTariff, findConvertibleSubscription and extendSecondarySubscription.
- Produces: eligible trial candidate has priority over paid fallback; disallowed trial conversion returns an error before Remnawave calls; allowed conversion calls remnaUpdateUser with the existing UUID and updates the same subscription row.

- [ ] Step 1: Add a failing regression for candidate ordering

В trial-conversion.test.ts прочитать source function и зафиксировать оба обязательных порядка:

    import { readFile } from "node:fs/promises";

    test("eligible trial is selected before multi-sub category fallback", async () => {
      const source = await readFile(new URL("./tariff-activation.service.ts", import.meta.url), "utf8");
      const start = source.indexOf("export async function findConvertibleSubscription");
      const body = source.slice(start, source.indexOf("export async function", start + 1));
      const trialQuery = body.indexOf("const trialCandidates");
      const categoryGuard = body.indexOf("if (multiSubEnabled && !perCategorySingle) return null");
      const fallbackGuard = body.indexOf("if (!candidate)");
      assert.ok(trialQuery > 0 && trialQuery < categoryGuard);
      assert.ok(fallbackGuard > trialQuery);
    });

- [ ] Step 2: Run the trial regression and verify it fails

    rtk node --import tsx --test src/modules/tariff/trial-conversion.test.ts

Expected: FAIL because the current early return precedes trialCandidates and the later fallback assignment overwrites a found trial.

- [ ] Step 3: Reorder findConvertibleSubscription without adding an abstraction

Move the existing trial candidate query before the multiSubEnabled && !perCategorySingle return. Keep candidate set to the eligible trial. Put the ordinary paid lookup under if (!candidate), and only return null from the category guard when no trial candidate exists. Do not change the existing trialAllowsTariff rules.

- [ ] Step 4: Add the shared trial policy guard before Remnawave access

Extend the subscription select/type used by extendSecondarySubscription with trial policy fields and place the guard after ownership/UUID validation but before getUser:

    if (sec.trialId && (!sec.trial || !trialAllowsTariff(sec.trial, tariff.id ?? ""))) {
      return { ok: false, error: "Переход с пробного тарифа на этот тариф запрещён", status: 400 };
    }

The balance route and external activation path will share the same policy. The existing update path remains responsible for trialId: null, new tariffId, new entitlement and uuid: sec.remnawaveUuid.

- [ ] Step 5: Extend tests for policy rejection and UUID preservation

Update the injected subscription fixture with a trial policy, assert a disallowed target returns ok: false without a getUser call, and capture updateUser input in the successful trial test:

    assert.equal(writes[0]?.uuid, "owning-uuid");

- [ ] Step 6: Run focused backend tests and verify they pass

    rtk node --import tsx --test src/modules/tariff/trial-conversion.test.ts src/modules/tariff/tariff-activation.service.test.ts src/modules/tariff/tariff-activation-ownership.test.ts

Expected: PASS, including eligible trial selection, policy rejection and preserved UUID.

- [ ] Step 7: Commit trial conversion fix

    rtk git add backend/src/modules/tariff/tariff-activation.service.ts backend/src/modules/tariff/tariff-activation.service.test.ts backend/src/modules/tariff/tariff-activation-ownership.test.ts backend/src/modules/tariff/trial-conversion.test.ts
    rtk git commit -m "fix: preserve subscription link during trial conversion"

### Task 4: Сделать balance route безопасным вокруг Payment и activation

**Files:**

- Modify: backend/src/modules/client/client.routes.ts:4310-4480
- Create: backend/src/modules/client/balance-payment.contract.test.ts

**Interfaces:**

- Consumes: existing atomic prisma.client.updateMany debit, createPayment, activation helpers and refund pattern.
- Produces: main tariff balance flow creates Payment before activation, marks it FAILED and refunds on activation exception/rejection, and returns the actual post-debit balance on success.

- [ ] Step 1: Add the failing route-order contract test

Создать source-contract test для main tariff branch, исключив proxy/Sing-box branches, которые уже создают Payment до slot activation:

    import assert from "node:assert/strict";
    import test from "node:test";
    import { readFile } from "node:fs/promises";

    test("main balance payment records Payment before activation and compensates failures", async () => {
      const source = await readFile(new URL("./client.routes.ts", import.meta.url), "utf8");
      const routeStart = source.indexOf('clientRouter.post("/payments/balance"');
      const mainStart = source.indexOf("const tariff = await prisma.tariff.findUnique", routeStart);
      const mainEnd = source.indexOf("// ——— Гибкий тариф", mainStart);
      const body = source.slice(mainStart, mainEnd);
      const debit = body.indexOf("const debit = await prisma.client.updateMany");
      const payment = body.indexOf("const payment = await createPayment");
      const activation = body.indexOf("let activateResult");
      assert.ok(debit > 0 && debit < payment && payment < activation);
      assert.match(body, /status:\s*"FAILED"/);
      assert.match(body, /balance:\s*\{\s*increment:\s*tariffPaySnap\.amount/);
    });

- [ ] Step 2: Run the contract test and verify it fails

    rtk node --import tsx --test src/modules/client/balance-payment.contract.test.ts

Expected: FAIL because the current main tariff Payment is created after activation and has no failed-payment compensation path.

- [ ] Step 3: Create the main tariff Payment immediately after the atomic debit

Move the existing main tariff createPayment call to after the main tariff debit and before let activateResult. Build initial metadata from values already known (promoCodeRecord, personal discount, extension id, remove-extras and additional-subscription flags). Keep status PAID, provider balance and the same amount/currency fields. Remove the later duplicate create call and keep only the later metadata/subscriptionId update.

- [ ] Step 4: Refund and fail the Payment on activation failure

Wrap the activation branch in try/catch. For both a returned ok:false and a thrown activation error, update Payment to FAILED and increment the client balance before returning:

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED" },
    }).catch(() => undefined);
    await prisma.client.update({
      where: { id: clientRaw.id },
      data: { balance: { increment: tariffPaySnap.amount } },
    }).catch(() => undefined);
    return res.status(status).json({ message });

Preserve the existing HTTP status/error for explicit failed activation; use 500 with the existing generic payment error for an unexpected exception. Do not send the success notification until activation and Payment linkage succeed.

- [ ] Step 5: Make post-success bookkeeping best-effort and return actual balance

Guard promoCodeUsage.create so a bookkeeping failure is logged rather than changing a successful payment into an error. After success, read select balance and return that value as newBalance; keep the existing response message, payment id and bot notification.

- [ ] Step 6: Run the contract test and backend suite

    rtk node --import tsx --test src/modules/client/balance-payment.contract.test.ts
    rtk npm test
    rtk npm run build

Expected: contract test, all backend tests and TypeScript build PASS.

- [ ] Step 7: Commit backend balance flow

    rtk git add backend/src/modules/client/client.routes.ts backend/src/modules/client/balance-payment.contract.test.ts
    rtk git commit -m "fix: keep balance payment result consistent after activation"

### Task 5: Интеграционная проверка mini-app и передача результата

**Files:**

- Verify: frontend/src/pages/cabinet/client-tariffs.tsx
- Verify: frontend/src/components/payment/extend-subscription-dialog.tsx
- Verify: backend/src/modules/client/client.routes.ts

**Interfaces:**

- Consumes: completed Tasks 1–4.
- Produces: evidence that the user sees one successful payment and trial conversion keeps the link.

- [ ] Step 1: Run all repository checks

Run the first command from backend and bot, and the second from frontend:

    rtk npm test
    rtk npm run build

- [ ] Step 2: Check the rendered mini-app payment state

Start frontend with rtk npm run dev -- --host 127.0.0.1, open the client tariff flow in the in-app browser, and verify that clicking “Оплатить с баланса” immediately renders Loader2, disables all payment buttons and prevents a second click until the response. If a signed-in local session is available, use balance 5000 and price 3360; expect one /client/payments/balance request, success UI, bot notification and balance 1640.

- [ ] Step 3: Check trial conversion semantics

With an eligible trial and a paid target tariff, open conversion preview and pay. Verify the preview says the trial becomes paid, no replacement flow is selected, the existing subscription row remains, trialId is cleared, tariffId changes and the Remnawave subscription URL/UUID is unchanged.

- [ ] Step 4: Run final diff checks

    rtk git diff --check
    rtk git status --short

Confirm only intended files changed; preserve the user’s pre-existing .vscode/settings.json, AGENTS.md and unrelated public-whitelist plan.


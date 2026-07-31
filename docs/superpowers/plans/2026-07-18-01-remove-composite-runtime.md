# Этап 1. Удаление composite runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести все рабочие пути на одного `Subscription.remnawaveUuid`, прекратить создание/слияние components и сохранить legacy component rows только как read-only источник для финальной миграции.

**Architecture:** Обычная STEALTHNET subscription снова соответствует ровно одному Remnawave user и отдает его прямой `subscriptionUrl` вида `https://sub.lazeika.xyz/<short-id>`. Все операции enable/disable/revoke/HWID/squad/extra-option выполняются над одним UUID. Composite-модели пока не удаляются из Prisma, чтобы этап 4 мог безопасно прочитать старые UUID и выполнить cutover.

**Tech Stack:** Node.js 22, TypeScript, Express, Prisma/PostgreSQL, существующий `remna.client.ts`, Node test runner через `tsx --test`, React 18/Vite.

## Global Constraints

- Сохранить все изменения `main`, не относящиеся исключительно к composite subscriptions.
- Одна `Subscription` использует не более одного `remnawaveUuid` во всех runtime-операциях.
- Не удалять строки `remnawave_components`, `tariff_remnawave_components`, `trial_remnawave_components` до этапа 4.
- Не менять формулу конвертации, оплату, подарки, Trial, HWID и автопродление.
- Во всех пользовательских payload возвращать только прямой `subscriptionUrl` Remnawave; не создавать STEALTHNET replacement URL.
- Полностью удалить runtime routes `/api/sub/:token` и `/api/public-subscription/:token`, а также custom public subscription page.
- Не удалять поле `publicSubscriptionToken` из Prisma до destructive cleanup этапа 4, но прекратить его чтение и запись в runtime с этапа 1.
- Не добавлять runtime dependency.

---

## File map

| Path | Action | Responsibility |
| --- | --- | --- |
| `backend/src/modules/subscription/single-subscription-lifecycle.service.ts` | Create | Enable/disable/revoke/delete одного UUID и единая запись sync error. |
| `backend/src/modules/subscription/single-subscription.contract.test.ts` | Create | Контракт «одна subscription — один runtime UUID». |
| `backend/src/app.ts` | Modify | Удалить composite/public subscription routers. |
| `backend/src/modules/admin/admin.routes.ts` | Modify | Удалить component CRUD/actions из рабочих admin endpoints. |
| `backend/src/modules/bot-admin/bot-admin.routes.ts` | Modify | Все действия бота-админа направить на один UUID. |
| `backend/src/modules/client/client.routes.ts` | Modify | Удалить component payload/replace URL и вернуть one-user payload. |
| `backend/src/modules/client/client-bulk-ops.service.ts` | Modify | Bulk enable/disable/revoke одного UUID на подписку. |
| `backend/src/modules/extra-options/extra-options.service.ts` | Modify | Применять squad/device/traffic option к одному UUID. |
| `backend/src/modules/gift/gift.service.ts` | Modify | Создание/выдача подарка создает одного Remnawave user. |
| `backend/src/modules/sync/sync.service.ts` | Modify | Синхронизировать один UUID, не восстанавливать components. |
| `backend/src/modules/tariff/tariff-activation.service.ts` | Modify | Удалить вызовы component synchronization после активации. |
| `backend/src/modules/diagnostics/diagnostics.routes.ts` | Modify | Удалить composite metrics, оставить single-sub health. |
| `backend/src/modules/subscription/subscription-maintenance.cron.ts` | Modify | Удалить component reconciliation cron. |
| `backend/src/modules/subscription/composite-subscription.routes.ts` | Delete | Удалить multi-upstream gateway и оба STEALTHNET subscription routes. |
| `backend/src/modules/subscription/public-subscription-page.ts` | Delete | Удалить custom browser model/page. |
| `backend/src/modules/subscription/public-subscription-page.test.ts` | Delete | Удалить тест custom page. |
| `backend/src/modules/subscription/composite-subscription.ts` | Delete | Удалить merge/detection/metrics. |
| `backend/src/modules/subscription/composite-subscription.test.ts` | Delete | Заменить single-sub tests. |
| `backend/src/modules/subscription/subscription-components.service.ts` | Delete | Удалить runtime component lifecycle; данные остаются в БД. |
| `backend/src/modules/subscription/subscription-components.service.test.ts` | Delete | Удалить component tests. |
| `backend/src/scripts/backfill-composite-subscriptions.ts` | Delete | Запретить новый backfill components. |
| `backend/package.json` | Modify | Удалить `backfill:composite-subscriptions`. |
| `frontend/src/components/admin/subscription-remna-panel.tsx` | Modify | Одна Remnawave subscription без списка components. |
| `frontend/src/pages/tariffs.tsx` | Modify | Удалить редактор components, сохранив обычные squad/limit/device поля. |
| `frontend/src/pages/trials.tsx` | Modify | Удалить trial component templates. |
| `frontend/src/pages/admin-diagnostics.tsx` | Modify | Удалить composite telemetry. |
| `frontend/src/lib/api.ts` | Modify | Удалить component types и методы. |
| `frontend/src/lib/admin-extras-api.ts` | Modify | Удалить composite metrics types. |
| `frontend/src/App.tsx` | Modify | Удалить route custom public subscription page, сохранив unrelated route fixes. |
| `frontend/src/pages/public-subscription.tsx` | Delete | Удалить custom page STEALTHNET. |

### Task 1: Зафиксировать границу удаления тестом и inventory

**Files:**
- Create: `backend/src/modules/subscription/single-subscription.contract.test.ts`
- Modify: `backend/src/modules/subscription/subscription-schema.test.ts`
- Preserve: `backend/prisma/schema.prisma`

**Interfaces:**
- Produces: исполнимый контракт, запрещающий runtime-зависимости от component API.
- Preserves: legacy Prisma models до этапа 4.

- [ ] **Step 1: Добавить падающий source-contract test**

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtimeFiles = [
  "../admin/admin.routes.ts",
  "../bot-admin/bot-admin.routes.ts",
  "../client/client.routes.ts",
  "../client/client-bulk-ops.service.ts",
  "../extra-options/extra-options.service.ts",
  "../gift/gift.service.ts",
  "../notification/telegram-notify.service.ts",
  "../sync/sync.service.ts",
  "../tariff/tariff-activation.service.ts",
];

test("runtime does not use composite component operations", async () => {
  for (const relative of runtimeFiles) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.doesNotMatch(source, /selectComponentTargets|synchronizeSubscriptionComponents|runSubscriptionComponentOperation/);
  }
});

test("runtime does not expose STEALTHNET subscription proxy routes", async () => {
  const app = await readFile(new URL("../../app.ts", import.meta.url), "utf8");
  const sources = await Promise.all(runtimeFiles.map((relative) => readFile(new URL(relative, import.meta.url), "utf8")));
  assert.doesNotMatch([app, ...sources].join("\n"), /publicSubscriptionToken|publicSubscriptionUrlForRequest|buildPublicSubscriptionUrl|\/api\/sub|public\/subscription-page/);
});
```

- [ ] **Step 2: Запустить тест и подтвердить текущий FAIL**

Run: `cd backend && npx tsx --test src/modules/subscription/single-subscription.contract.test.ts`

Expected: FAIL с первым найденным composite runtime symbol.

- [ ] **Step 3: Зафиксировать inventory legacy-данных в комментарии миграционного контракта**

В `subscription-schema.test.ts` оставить проверку наличия трех legacy tables и комментарий: они read-only с этапа 1 и удаляются только задачей cleanup этапа 4. Не добавлять compatibility write.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/subscription/single-subscription.contract.test.ts backend/src/modules/subscription/subscription-schema.test.ts
git commit -m "test: define single-subscription runtime boundary"
```

### Task 2: Вернуть прямой Remnawave subscription URL

**Files:**
- Modify: `backend/src/app.ts`
- Modify: `backend/src/modules/client/client.routes.ts`
- Modify: `backend/src/modules/gift/gift.service.ts`
- Modify: `backend/src/modules/notification/telegram-notify.service.ts`
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Modify: `frontend/src/App.tsx`
- Delete: `backend/src/modules/subscription/composite-subscription.routes.ts`
- Delete: `backend/src/modules/subscription/public-subscription-page.ts`
- Delete: `backend/src/modules/subscription/public-subscription-page.test.ts`
- Delete: `frontend/src/pages/public-subscription.tsx`
- Test: `backend/src/modules/subscription/single-subscription.contract.test.ts`

**Interfaces:**
- Consumes: существующие `remnaGetUser(uuid)` и `extractRemnaSubscriptionUrl(payload)`.
- Produces: прямой Remnawave `subscriptionUrl` во всех client/admin/gift/notification payload.
- Removes: оба STEALTHNET proxy routes и custom public page.

- [ ] **Step 1: Добавить падающий direct URL contract**

Проверить, что helper извлекает прямой URL из одного Remnawave user и source-contract запрещает replacement URL/runtime routes.

```ts
test("returns the direct Remnawave subscription URL", () => {
  assert.equal(
    extractRemnaSubscriptionUrl({ response: { subscriptionUrl: "https://sub.lazeika.xyz/w4Q1vC-beWy-Rzbg" } }),
    "https://sub.lazeika.xyz/w4Q1vC-beWy-Rzbg",
  );
});
```

- [ ] **Step 2: Восстановить прежний one-user payload**

В client/admin/gift/notification flows после `remnaGetUser(subscription.remnawaveUuid)` вернуть `extractRemnaSubscriptionUrl(result.data)`. Удалить `replaceRemnaSubscriptionUrlInPlace`, `publicSubscriptionUrlForRequest`, `buildPublicSubscriptionUrl` и чтение `publicSubscriptionToken` из runtime selects.

- [ ] **Step 3: Удалить proxy и custom page**

Удалить mounts из `backend/src/app.ts`, backend gateway/page files, frontend route `/subscription/:publicSubscriptionToken` и `frontend/src/pages/public-subscription.tsx`. Не трогать unrelated routes в уже измененном `frontend/src/App.tsx`.

- [ ] **Step 4: Проверить отсутствие routes и replacement URL**

Run: `rg -n "api/sub|public/subscription-page|api/public-subscription|publicSubscriptionToken|publicSubscriptionUrlForRequest|buildPublicSubscriptionUrl" backend/src frontend/src --glob '!**/*.md'`

Expected: zero runtime matches; временный Prisma field допускается только в schema/migration contract до этапа 4.

- [ ] **Step 5: Проверить backend**

Run: `cd backend && npx tsx --test src/modules/subscription/single-subscription.contract.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app.ts backend/src/modules/client/client.routes.ts backend/src/modules/gift/gift.service.ts backend/src/modules/notification/telegram-notify.service.ts backend/src/modules/admin/admin.routes.ts backend/src/modules/subscription/composite-subscription.routes.ts backend/src/modules/subscription/public-subscription-page.ts backend/src/modules/subscription/public-subscription-page.test.ts frontend/src/App.tsx frontend/src/pages/public-subscription.tsx
git commit -m "refactor: restore direct Remnawave subscription URLs"
```

### Task 3: Централизовать lifecycle одного Remnawave user

**Files:**
- Create: `backend/src/modules/subscription/single-subscription-lifecycle.service.ts`
- Create: `backend/src/modules/subscription/single-subscription-lifecycle.service.test.ts`
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Modify: `backend/src/modules/bot-admin/bot-admin.routes.ts`
- Modify: `backend/src/modules/client/client-bulk-ops.service.ts`
- Modify: `backend/src/modules/sync/sync.service.ts`

**Interfaces:**
- Produces: `requireSubscriptionRemnaUuid(subscriptionId): Promise<string>`.
- Produces: `enableSingleSubscription`, `disableSingleSubscription`, `revokeSingleSubscription`, `deleteSingleSubscription`.
- Side effect: при Remnawave error обновляет существующие `syncStatus`, `syncAttempts`, `syncError`, `syncRequiredAt`.

- [ ] **Step 1: Написать lifecycle tests**

Проверить: ровно один API-вызов; отсутствующий UUID возвращает доменную ошибку; retry записывает `PENDING`; revoke обновляет только одну subscription.

- [ ] **Step 2: Реализовать один target без новой абстракции components**

```ts
export async function requireSubscriptionRemnaUuid(subscriptionId: string): Promise<string> {
  const row = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: { remnawaveUuid: true },
  });
  if (!row?.remnawaveUuid) throw new Error("Подписка не привязана к Remnawave");
  return row.remnawaveUuid;
}
```

Каждая операция вызывает соответствующий существующий метод `remna.client.ts` один раз. Не создавать interface/factory для одного клиента.

- [ ] **Step 3: Перевести admin и bot-admin actions**

Удалить `componentKey` из request schema и response, component-specific routes и циклы. Полный revoke сохраняет текущую tombstone/retry семантику на уровне `Subscription`.

- [ ] **Step 4: Перевести bulk и sync**

Bulk-операция может обрабатывать много subscriptions, но по одному UUID на каждую. `sync.service.ts` не читает и не создает component rows.

- [ ] **Step 5: Запустить targeted tests**

Run: `cd backend && npx tsx --test src/modules/subscription/single-subscription-lifecycle.service.test.ts`

Expected: lifecycle tests PASS. Затем отдельно запустить `single-subscription.contract.test.ts`: после Task 3 допускается RED только на symbols в Task 4-owned files (`client.routes.ts`, `extra-options.service.ts`, `gift.service.ts`, `tariff-activation.service.ts`); admin/bot-admin/bulk/sync совпадений быть не должно. Полный source-contract становится PASS в Task 4.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/subscription/single-subscription-lifecycle.service.ts backend/src/modules/subscription/single-subscription-lifecycle.service.test.ts backend/src/modules/admin/admin.routes.ts backend/src/modules/bot-admin/bot-admin.routes.ts backend/src/modules/client/client-bulk-ops.service.ts backend/src/modules/sync/sync.service.ts
git commit -m "refactor: operate on one Remnawave user"
```

### Task 4: Удалить component writes из покупки, подарков и extra options

**Files:**
- Modify: `backend/src/modules/tariff/tariff-activation.service.ts`
- Modify: `backend/src/modules/client/client.routes.ts`
- Modify: `backend/src/modules/extra-options/extra-options.service.ts`
- Modify: `backend/src/modules/gift/gift.service.ts`
- Test: existing tests рядом с этими modules и `single-subscription.contract.test.ts`.

**Interfaces:**
- Consumes: один `Subscription.remnawaveUuid`.
- Preserves: `computeConvertedDays`, `extendSecondarySubscription`, `findConvertibleSubscription`, `activateTariffByPaymentId`.

- [ ] **Step 1: Добавить regressions**

Покупка, продление, подарок и extra option должны вызвать `remnaCreateUser` не более одного раза и никогда не писать `remnawaveComponent`.

- [ ] **Step 2: Удалить component synchronization**

Удалить `synchronizeSubscriptionComponents`, `selectComponentTargets` и зеркальные `prisma.remnawaveComponent.updateMany`. Обычные поля `trafficLimitBytes`, `activeInternalSquads`, `hwidDeviceLimit`, `expireAt` остаются на одном Remnawave user.

- [ ] **Step 3: Не менять математику**

Оставить без изменений:

```ts
convertedDays = Math.floor((remainingDays * oldPricePerDay) / newPricePerDay);
```

На этом этапе не добавлять локальный quota lifecycle; он появится в этапе 2.

- [ ] **Step 4: Проверить полный backend suite**

Run: `cd backend && npm test`

Expected: exit code 0; source-contract PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tariff/tariff-activation.service.ts backend/src/modules/client/client.routes.ts backend/src/modules/extra-options/extra-options.service.ts backend/src/modules/gift/gift.service.ts backend/src/modules/subscription/single-subscription.contract.test.ts
git commit -m "refactor: remove component writes from subscription flows"
```

### Task 5: Удалить component UI и API configuration

**Files:**
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Modify: `frontend/src/pages/tariffs.tsx`
- Modify: `frontend/src/pages/trials.tsx`
- Modify: `frontend/src/components/admin/subscription-remna-panel.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/admin-extras-api.ts`
- Modify: `frontend/src/pages/admin-diagnostics.tsx`

**Interfaces:**
- Tariff/Trial API продолжает отдавать `internalSquadUuids`, `trafficLimitBytes`, `trafficResetMode`.
- Component templates и ручной component CRUD больше не принимаются и не отображаются.

- [ ] **Step 1: Удалить backend input/output component fields**

Удалить `remnawaveComponentInputSchema`, `remnawaveComponentsSchema`, nested create/update и component includes. Legacy rows остаются нетронутыми в БД.

- [ ] **Step 2: Упростить tariff/trial forms**

Удалить блоки «Компоненты Remnawave/составной подписки», add/remove/reorder component state и payload. Сохранить обычный multi-select squad, traffic limit, reset, devices, price options и прочие текущие поля.

- [ ] **Step 3: Упростить subscription panel**

Показывать один UUID, статус, expireAt, squads, traffic/HWID и обычные действия. Удалить component cards и componentKey actions.

- [ ] **Step 4: Собрать frontend**

Run: `cd frontend && npm run build`

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/admin/admin.routes.ts frontend/src/pages/tariffs.tsx frontend/src/pages/trials.tsx frontend/src/components/admin/subscription-remna-panel.tsx frontend/src/lib/api.ts frontend/src/lib/admin-extras-api.ts frontend/src/pages/admin-diagnostics.tsx
git commit -m "refactor: remove composite subscription UI"
```

### Task 6: Удалить composite implementation, backfill и reconciliation

**Files:**
- Delete: `backend/src/modules/subscription/composite-subscription.ts`
- Delete: `backend/src/modules/subscription/composite-subscription.test.ts`
- Delete: `backend/src/modules/subscription/subscription-components.service.ts`
- Delete: `backend/src/modules/subscription/subscription-components.service.test.ts`
- Delete: `backend/src/scripts/backfill-composite-subscriptions.ts`
- Modify: `backend/src/modules/subscription/subscription-maintenance.cron.ts`
- Modify: `backend/src/modules/diagnostics/diagnostics.routes.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Preserves: legacy Prisma models/rows только для этапа 4.
- Removes: component reconciliation, merge metrics, backfill command.

- [ ] **Step 1: Убедиться, что удаляемые modules не импортируются**

Run: `rg -n "composite-subscription|subscription-components.service" backend/src frontend/src`

Expected: только удаляемые files или design/plan docs.

- [ ] **Step 2: Удалить files и cron**

`subscription-maintenance.cron.ts` либо удалить, если в нем не осталось single-user работы, либо оставить только действительно используемую one-user retry функцию. Удалить `backfill:composite-subscriptions` из `package.json`.

- [ ] **Step 3: Проверить отсутствие runtime tails**

Run: `rg -n "RemnawaveComponent|remnawaveComponents|selectComponentTargets|compositeSubscription" backend/src frontend/src --glob '!**/*.md'`

Expected: совпадения допускаются только в `subscription-schema.test.ts` как временный legacy migration contract.

- [ ] **Step 4: Полная проверка этапа**

Run: `cd backend && npm test && npm run build`

Run: `cd frontend && npm run build`

Expected: все команды exit code 0.

- [ ] **Step 5: Ручная smoke-проверка**

- Получить `subscriptionUrl` тестовой subscription через client API и убедиться, что это `https://sub.lazeika.xyz/<short-id>`.
- Открыть прямую ссылку VPN-клиентом и браузером; запросы не должны проходить через STEALTHNET backend.
- Выполнить enable, disable и revoke тестовой subscription.
- Купить/продлить тестовый тариф и убедиться, что создан один Remnawave user.
- Убедиться, что legacy component rows не изменились.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/subscription/composite-subscription.ts backend/src/modules/subscription/composite-subscription.test.ts backend/src/modules/subscription/subscription-components.service.ts backend/src/modules/subscription/subscription-components.service.test.ts backend/src/scripts/backfill-composite-subscriptions.ts backend/src/modules/subscription/subscription-maintenance.cron.ts backend/src/modules/diagnostics/diagnostics.routes.ts backend/src/index.ts backend/package.json
git commit -m "refactor: retire composite subscription runtime"
```

## Stage acceptance

- `npm test` и оба build проходят.
- Ни один runtime flow не читает component targets и не создает второй user.
- Все client/admin/gift/notification payload отдают прямой Remnawave `subscriptionUrl`; STEALTHNET proxy/page отсутствуют.
- Админ-панель управляет одной Remnawave subscription.
- Composite code/backfill/reconciliation удалены.
- Legacy component tables и данные сохранены неизменными для этапа 4.

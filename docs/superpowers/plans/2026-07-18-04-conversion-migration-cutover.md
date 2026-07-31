# Этап 4. Конвертация, миграция клиентов и production cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подключить локальные периоды ко всем продлениям и upgrade/downgrade, принудительно пересоздать каждую active/expired клиентскую subscription как одного обычного Remnawave user с прямой ссылкой, начать whitelist usage с нуля и окончательно удалить composite schema/data/code.

**Architecture:** Существующая `computeConvertedDays()` остается единственной формулой pro-rata. Возобновляемый cutover script использует существующий `AdminEvent` как durable journal: snapshot → replacement created → direct Remnawave URL verified → switched → old users cleaned. Скрипт обрабатывает все active/expired subscriptions, включая уже одиночные; старые users не удаляются до проверки replacement.

**Tech Stack:** Node.js/TypeScript, Prisma/PostgreSQL, Remnawave 2.8 API, existing audit log, backend/client tests, production smoke checks.

## Global Constraints

- Этапы 1–3 завершены; enforcement остается выключен до Task 6.
- Перед любым apply: backup обеих PostgreSQL databases и deployment directory.
- Dry-run является default; mutation требует явный `--apply`.
- Миграция идемпотентна и возобновляема по `Subscription.id`.
- Каждая active/expired `Subscription` получает нового обычного Remnawave user; already-single записи не пропускаются.
- Новому обычному user передаются точные `createdAt` и `expireAt`.
- Expired subscription остается expired и не получает дополнительного времени.
- Каждый новый user обязан вернуть прямой `subscriptionUrl` на домене `sub.lazeika.xyz`; STEALTHNET proxy routes не возвращаются.
- Для `LOCAL_SQUAD` новый Remnawave user имеет `trafficLimitBytes=0`, `NO_RESET`.
- Старые whitelist usage/limits не переносятся; local `usedBytes=0` и baseline начинается в cutover.
- Старые component users нельзя delete/revoke до проверки новой обычной subscription.
- Не удалять полезные non-composite migrations/features.
- Формула дней не переписывается и не дублируется.

---

## File map

| Path | Action | Responsibility |
| --- | --- | --- |
| `backend/src/modules/tariff/tariff-activation.service.ts` | Modify | Подключить quota lifecycle ко всем convert/renew paths. |
| `backend/src/modules/tariff/tariff-activation.service.test.ts` | Modify/Create | Upgrade/downgrade/same tariff/Trial/local mode. |
| `backend/src/modules/payment/auto-renew.cron.ts` | Modify | Использовать центральный activation result без отдельного reset. |
| `backend/src/modules/extra-options/extra-options.service.ts` | Modify | Traffic add-on создает quota grant в local mode. |
| `backend/src/modules/squad-traffic/traffic-entitlement.service.ts` | Modify | Tariff transition и expired renewal semantics. |
| `backend/src/scripts/migrate-composite-to-single.ts` | Create | Dry-run/apply/resume/reconcile cutover. |
| `backend/src/scripts/migrate-composite-to-single.test.ts` | Create | State machine и exact payload. |
| `backend/package.json` | Modify | Добавить migration commands. |
| `backend/prisma/migrations/20260718030000_drop_composite_subscription/migration.sql` | Create last | Drop component tables только после cutover. |
| `backend/prisma/schema.prisma` | Modify last | Удалить legacy component models/relations. |
| `backend/src/modules/subscription/subscription-schema.test.ts` | Modify last | Запретить composite schema. |
| `docs/runbooks/single-subscription-cutover.md` | Create | Exact production runbook и rollback. |

### Task 1: Зафиксировать конвертацию и quota transition tests

**Files:**
- Modify/Create: `backend/src/modules/tariff/tariff-activation.service.test.ts`
- Modify: `backend/src/modules/squad-traffic/traffic-entitlement.service.test.ts`
- Preserve: `backend/src/modules/tariff/tariff-activation.service.ts:computeConvertedDays`

**Interfaces:**
- Preserves: `computeConvertedDays({remainingDays, oldPricePerDay, newPricePerDay})`.
- Produces: один post-activation quota transition для renew/convert/Trial.

- [ ] **Step 1: Добавить pure formula regressions**

```ts
test("converts remaining value into new tariff days", () => {
  assert.equal(computeConvertedDays({
    remainingDays: 30,
    oldPricePerDay: 10,
    newPricePerDay: 20,
  }), 15);
});

test("same daily price keeps days one to one", () => {
  assert.equal(computeConvertedDays({ remainingDays: 30, oldPricePerDay: 10, newPricePerDay: 10 }), 30);
});
```

- [ ] **Step 2: Добавить integration cases**

- upgrade: меньше converted days, новый tariff quota period;
- downgrade: больше converted days, новый tariff quota period;
- тот же тариф: current period/used/grant остаются;
- Trial → paid: trial usage не переносится, новый period starts now;
- `WHILE_TARIFF_ACTIVE` удаляется только при tariffId change;
- `CURRENT_PERIOD` не переживает tariffId change;
- переход `REMNAWAVE`→`LOCAL_SQUAD` ставит Remnawave 0/NO_RESET;
- переход `LOCAL_SQUAD`→`REMNAWAVE` применяет обычный global limit/reset.

- [ ] **Step 3: Запустить tests до изменений**

Run: `cd backend && npx tsx --test src/modules/tariff/tariff-activation.service.test.ts src/modules/squad-traffic/traffic-entitlement.service.test.ts`

Expected: новые integration cases FAIL.

- [ ] **Step 4: Commit tests**

```bash
git add backend/src/modules/tariff/tariff-activation.service.test.ts backend/src/modules/squad-traffic/traffic-entitlement.service.test.ts
git commit -m "test: cover quota-aware tariff conversion"
```

### Task 2: Подключить quota lifecycle ко всем activation paths

**Files:**
- Modify: `backend/src/modules/tariff/tariff-activation.service.ts`
- Modify: `backend/src/modules/payment/auto-renew.cron.ts`
- Modify: `backend/src/modules/extra-options/extra-options.service.ts`
- Modify: `backend/src/modules/squad-traffic/traffic-entitlement.service.ts`

**Interfaces:**
- Consumes: existing activation result и `applyTrafficEntitlement` этапа 2.
- Produces: один вызов quota transition на successful activation.

- [ ] **Step 1: Ввести один finalize helper**

```ts
async function finalizeTrafficEntitlement(input: {
  subscriptionId: string;
  previousTariffId: string | null;
  nextTariff: TrafficEntitlementInput;
  reason: "PURCHASE" | "RENEW" | "CONVERT" | "TRIAL_CONVERT" | "AUTO_RENEW";
  now: Date;
}) {
  return applyTrafficEntitlement(input);
}
```

Helper вызывается только после успешного Remnawave create/update. Если локальная DB transaction падает, subscription получает `syncStatus=PENDING`; payment не активирует второй user при retry.

- [ ] **Step 2: Покрыть все branches**

Проверить `activateTariffForClient`, `extendSecondarySubscription`, `activateTariffByPaymentId`, explicit extend, single-category conversion, global single hard replace, Trial replacement, gift/self activation и auto-renew. Все должны сходиться в finalize, а не копировать правила period reset.

- [ ] **Step 3: Local traffic extra option**

Если существующая extra option добавляет traffic:

- `REMNAWAVE`: сохранить текущее увеличение global limit;
- `LOCAL_SQUAD`: создать `CURRENT_PERIOD` grant тем же entitlement service;
- не обновлять `RemnawaveComponent` и не увеличивать Remnawave global limit.

Это становится готовым backend primitive для будущей покупки гигабайт.

- [ ] **Step 4: Проверить**

Run: `cd backend && npx tsx --test src/modules/tariff/tariff-activation.service.test.ts src/modules/squad-traffic/traffic-entitlement.service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tariff/tariff-activation.service.ts backend/src/modules/payment/auto-renew.cron.ts backend/src/modules/extra-options/extra-options.service.ts backend/src/modules/squad-traffic/traffic-entitlement.service.ts
git commit -m "feat: preserve quota lifecycle across tariff changes"
```

### Task 3: Реализовать dry-run inventory и durable cutover journal

**Files:**
- Create: `backend/src/scripts/migrate-composite-to-single.ts`
- Create: `backend/src/scripts/migrate-composite-to-single.test.ts`
- Modify: `backend/package.json`
- Reuse: `backend/src/modules/audit/audit.service.ts`

**Interfaces:**
- CLI: `npm run migrate:single-subscription -- --dry-run`.
- CLI: `npm run migrate:single-subscription -- --apply --subscription <id>`.
- CLI: `npm run migrate:single-subscription -- --apply --resume`.
- Journal kinds: `subscription.cutover.snapshot`, `.replacement_created`, `.verified`, `.switched`, `.legacy_cleaned`, `.failed`.

- [ ] **Step 1: Написать state-machine tests**

Проверить default dry-run, apply guard, resume after each state, duplicate execution skip, API error, ambiguous dates/squads stop и обязательный replacement для already-single subscription.

- [ ] **Step 2: Собрать inventory без mutation**

Для каждой subscription вывести:

```ts
type CutoverInventory = {
  subscriptionId: string;
  ownerId: string;
  active: boolean;
  createdAt: string;
  expireAt: string;
  tariffId: string | null;
  targetSquads: string[];
  trafficLimitMode: "REMNAWAVE" | "LOCAL_SQUAD";
  oldUuids: string[];
  canonicalUuid: string | null;
  blockers: string[];
};
```

Источники дат: `Subscription.createdAt`, `Subscription.expireAt`; если expireAt null — read canonical Remnawave user и записать явный blocker/fallback в snapshot. Не угадывать дату.

Inventory обязан охватить все локальные subscriptions со статусом active или expired, независимо от наличия legacy component rows. И active, и expired проходят replacement flow. Для expired сохраняется прежний `expireAt`; прошлую дату нельзя сдвигать вперед. Tombstone/deletion-requested записи не восстанавливаются и получают явный cleanup-only snapshot.

- [ ] **Step 3: Писать journal в существующий AdminEvent**

Использовать `logAdminEvent(kind, "migration", null, {type:"subscription", id}, payload)`. Перед каждым шагом читать последний event для target. Не добавлять временную migration table.

- [ ] **Step 4: Добавить package commands**

```json
{
  "migrate:single-subscription": "tsx src/scripts/migrate-composite-to-single.ts"
}
```

Удаленный `backfill:composite-subscriptions` не возвращать.

- [ ] **Step 5: Проверить dry-run на локальной БД**

Run: `cd backend && npm run migrate:single-subscription -- --dry-run`

Expected: exit code 0, только если каждая active/expired subscription имеет zero blockers, а для каждой tombstone-записи определен безопасный cleanup path; никакие строки/Remnawave users не изменены.

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/migrate-composite-to-single.ts backend/src/scripts/migrate-composite-to-single.test.ts backend/package.json
git commit -m "feat: inventory composite subscription cutover"
```

### Task 4: Пересоздать одну обычную Remnawave subscription

**Files:**
- Modify: `backend/src/scripts/migrate-composite-to-single.ts`
- Modify: `backend/src/scripts/migrate-composite-to-single.test.ts`

**Interfaces:**
- Produces: replacement user payload и verified atomic switch.
- Produces: прямой `subscriptionUrl` Remnawave, проверенный до DB switch.

- [ ] **Step 1: Написать exact payload test**

```ts
assert.deepEqual(payload, {
  username: expectedUniqueUsername,
  createdAt: originalCreatedAt,
  expireAt: originalExpireAt,
  status: "ACTIVE",
  activeInternalSquads: tariffSquads,
  trafficLimitBytes: 0,
  trafficLimitStrategy: "NO_RESET",
  hwidDeviceLimit: expectedDeviceLimit,
});
```

Для `REMNAWAVE` expected traffic fields берутся из тарифа.

Добавить отдельный case для expired: payload сохраняет исходные `createdAt`/`expireAt`, а проверка подтверждает, что прошедший `expireAt` не был продлен.

- [ ] **Step 2: Create replacement before destructive action**

Сгенерировать детерминированный уникальный username с suffix subscription ID. Вызвать `remnaCreateUser`, записать returned UUID/username/shortUuid в `.replacement_created`. Старые users остаются активными.

- [ ] **Step 3: Verify replacement**

Выполнить:

- `remnaGetUser(newUuid)` и exact field comparison;
- fetch обычной Remnawave subscription URL;
- exact host check `new URL(subscriptionUrl).hostname === "sub.lazeika.xyz"`;
- проверку expected squads, status, `createdAt`, `expireAt`, HWID/traffic fields.

Любое расхождение → `.failed`, DB switch запрещен.

- [ ] **Step 4: Atomic local switch**

В одной STEALTHNET transaction:

- обновить `Subscription.remnawaveUuid`, `remnawaveUsername`, `remnawaveShortUuid`;
- для `LOCAL_SQUAD` создать/reset `SquadTrafficQuota` с `usedBytes=0`;
- очистить `TrafficUsageCheckpoint`, чтобы первый worker sample стал baseline и не начислил историю;
- записать quota event `CUTOVER_RESET`.

После transaction записать `.switched` в AdminEvent.

- [ ] **Step 5: Зафиксировать проверенный direct URL**

Записать проверенный `subscriptionUrl` и normalized host в `.verified`. DB switch запрещен, если URL отсутствует, не загружается или его host не равен `sub.lazeika.xyz`.

- [ ] **Step 6: Проверить тестового клиента**

Run: `cd backend && npm run migrate:single-subscription -- --apply --subscription <TEST_SUBSCRIPTION_ID>`

Expected: новый user verified/switched; старые users еще активны; прямой URL `sub.lazeika.xyz/<short-id>` отдает новую обычную subscription; local used=0.

- [ ] **Step 7: Commit**

```bash
git add backend/src/scripts/migrate-composite-to-single.ts backend/src/scripts/migrate-composite-to-single.test.ts
git commit -m "feat: migrate subscriptions to ordinary Remnawave users"
```

### Task 5: Безопасно удалить старых component users

**Files:**
- Modify: `backend/src/scripts/migrate-composite-to-single.ts`
- Create: `docs/runbooks/single-subscription-cutover.md`

**Interfaces:**
- Cleanup eligibility: `.verified` с direct URL proof + `.switched`.
- CLI: `--cleanup-legacy --apply`.

- [ ] **Step 1: Запретить cleanup без proof**

Подписка без `.verified` или `.switched` получает blocker `REPLACEMENT_NOT_VERIFIED`. Старый user нельзя удалить по timeout или только по факту создания replacement.

- [ ] **Step 2: Revoke затем delete old UUIDs**

Исключить replacement UUID и текущий `Subscription.remnawaveUuid`. Для каждого old UUID: revoke, GET verify revoked, delete, GET verify 404. Partial failure записать и возобновить с оставшегося UUID.

Active и expired subscription требуют одинаковый proof: replacement verified, прямой URL проверен, local UUID switched. Tombstone cleanup не создаёт replacement, но требует snapshot с подтверждённым deletion state.

- [ ] **Step 3: Создать runbook**

Runbook содержит exact backup commands, dry-run, one-client apply, verification, batch resume, cleanup и rollback switch на old UUID до его удаления.

- [ ] **Step 4: Batch migration текущих клиентов**

Run: `cd backend && npm run migrate:single-subscription -- --dry-run`

Run: `cd backend && npm run migrate:single-subscription -- --apply --resume`

Expected: все active/expired subscriptions имеют `.verified` и `.switched`; old users сохранены до proof; tombstone subscriptions либо `.legacy_cleaned`, либо имеют явный blocker.

- [ ] **Step 5: Cleanup eligible clients**

Run: `cd backend && npm run migrate:single-subscription -- --cleanup-legacy --apply`

Expected: `.legacy_cleaned` для всех eligible; ineligible перечислены без mutation.

- [ ] **Step 6: Commit runbook**

```bash
git add backend/src/scripts/migrate-composite-to-single.ts docs/runbooks/single-subscription-cutover.md
git commit -m "docs: add rollback-safe subscription cutover"
```

### Task 6: Observe-only сверка EU/WL и включение enforcement

**Files:**
- No source change unless verification finds a defect.
- Update: `docs/runbooks/single-subscription-cutover.md` with measured results.

**Interfaces:**
- Existing worker diagnostics and `squad_traffic_enforcement_enabled` setting.

- [ ] **Step 1: Снять baseline после cutover**

Убедиться, что каждая local quota имеет `usedBytes=0`, checkpoint отсутствует/инициализируется без delta, Remnawave global limit=0. Отдельной контрольной выборкой подтвердить, что Remnawave stats `start/end` используют те же UTC day boundaries; при несовпадении enforcement не включать.

- [ ] **Step 2: Выполнить контроль EU**

Создать минимум 100 MB трафика через `auto-wl`/EU. Дождаться двух worker passes. Expected: local used не изменился.

- [ ] **Step 3: Выполнить контроль WL**

Создать известный объем через `whitelist-balancer`/WL. Expected: local used изменился в пределах погрешности одного poll; EU bytes отсутствуют.

- [ ] **Step 4: Проверить cutoff/reset на тестовом клиенте**

Выдать малый current-period limit, пересечь 50/25/10/3/0, проверить Telegram и удаление только Whitelist. Выполнить rollover/`CURRENT_PERIOD` top-up и проверить восстановление Whitelist.

- [ ] **Step 5: Зафиксировать нагрузочные результаты**

В runbook записать Remnawave version, число users/nodes, API duration, DB apply duration, total pass duration, response row count/topUsersLimit, overshoot.

- [ ] **Step 6: Включить enforcement**

Сначала для внутреннего тестового тарифа/аккаунта, затем глобально выставить `squad_traffic_enforcement_enabled=true`. Если implementation имеет только глобальный switch, тестовый этап выполняется отдельной staging installation; не добавлять rollout-framework только ради 10 клиентов.

### Task 7: Физически удалить composite schema и финальные хвосты

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260718030000_drop_composite_subscription/migration.sql`
- Modify: `backend/src/modules/subscription/subscription-schema.test.ts`
- Stop condition: если `rg` найдет неожиданный runtime tail после этапа 1, не расширять финальный destructive commit наугад; сначала добавить конкретный cleanup task в этот план.

**Interfaces:**
- Removes: `RemnawaveComponent`, `TariffRemnawaveComponent`, `TrialRemnawaveComponent` and relations.
- Removes: `Subscription.publicSubscriptionToken` и его unique index после подтверждения отсутствия runtime reads.
- Preserves: `Subscription`, `SecondarySubscription`/gift/trial behavior и quota models.

- [ ] **Step 1: Gate destructive migration**

SQL precondition должен остановить migration, если существует хотя бы одна component row без `subscription.cutover.legacy_cleaned` audit proof — активная или неактивная. До SQL migration повторно сделать backup.

- [ ] **Step 2: Drop только composite tables**

Удалить FK/relations и таблицы:

```sql
DROP TABLE "trial_remnawave_components";
DROP TABLE "tariff_remnawave_components";
DROP TABLE "remnawave_components";
DROP INDEX "subscriptions_public_subscription_token_key";
ALTER TABLE "subscriptions" DROP COLUMN "public_subscription_token";
```

Не удалять `subscriptions`, gifts, Trial, sync fields или quota data.

- [ ] **Step 3: Обновить Prisma schema contract**

```ts
assert.doesNotMatch(schema, /RemnawaveComponent|remnawave_components/);
assert.doesNotMatch(schema, /publicSubscriptionToken|public_subscription_token/);
assert.match(schema, /model Subscription/);
assert.match(schema, /model SquadTrafficQuota/);
```

- [ ] **Step 4: Repository-wide tail scan**

Run: `rg -n -i "composite.subscription|RemnawaveComponent|TariffRemnawaveComponent|TrialRemnawaveComponent|componentKey|backfill:composite|publicSubscriptionToken|api/sub|public/subscription-page|api/public-subscription" backend frontend bot --glob '!**/node_modules/**' --glob '!**/dist/**'`

Expected: zero runtime matches. Historical design/plans may remain only as documentation clearly marked rejected; executable scripts/configs must be zero.

- [ ] **Step 5: Полная verification**

Run: `cd backend && npx prisma validate && npm test && npm run build`

Run: `cd frontend && npm run build`

Expected: all exit code 0.

- [ ] **Step 6: Production smoke**

- Обычная Remnawave subscription открывается у каждого текущего клиента.
- Exact createdAt/expireAt выборочно сверены с cutover snapshot.
- Default работает; Whitelist учитывается; EU не учитывается.
- Upgrade, downgrade, same-tariff renew, Trial convert, auto-renew, gift, revoke и `+N ГБ` проходят.
- Admin diagnostics green; checkpoint row count ≤ active local quotas.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260718030000_drop_composite_subscription/migration.sql backend/src/modules/subscription/subscription-schema.test.ts
git commit -m "refactor: remove composite subscription schema"
```

## Stage acceptance

- Все active и expired subscriptions имеют один новый обычный Remnawave user; already-single subscriptions также конвертированы.
- Все tombstone и legacy component records обработаны и имеют `.legacy_cleaned` до drop schema.
- `createdAt` и `expireAt` совпадают с cutover snapshot.
- `publicSubscriptionToken`, `/api/sub/:token`, `/api/public/subscription-page/:token`, `/api/public-subscription/:token` и custom public page удалены.
- Старый whitelist usage не перенесен; локальный учет стартовал с 0.
- Ни один old user не удален до подтвержденного fetch нового прямого Remnawave URL.
- Upgrade/downgrade и продления используют существующую формулу.
- Composite code, package scripts, Prisma models и tables отсутствуют.
- Default/EU access не тарифицируется; Whitelist тарифицируется и отзывается отдельно.
- Enforcement включен только после observe-only evidence.

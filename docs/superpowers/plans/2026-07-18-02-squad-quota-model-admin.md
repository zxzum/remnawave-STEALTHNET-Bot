# Этап 2. Модель локального лимита squad и админ-панель Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить взаимоисключающие режимы лимита `REMNAWAVE`/`LOCAL_SQUAD`, один ограниченный quota-state на подписку, персональные месячные периоды, Trial limits и два типа дополнительных гигабайт с полной интеграцией во все административные формы и карточки.

**Architecture:** Существующие `trafficLimitBytes` и `trafficResetMode` остаются источником величины лимита, а новые `trafficLimitMode` и `meteredSquadUuid` определяют, кто его применяет. Для локального режима одна строка `SquadTrafficQuota` хранит только текущее состояние; значимые события пишутся в небольшой audit stream, а дополнительные гигабайты — отдельными отзывными grants.

**Tech Stack:** Prisma/PostgreSQL, TypeScript, Express/Zod, React 18, существующие admin/client API и Remnawave transport.

## Global Constraints

- Этап 1 полностью завершен и runtime использует один `Subscription.remnawaveUuid`.
- Пользовательские payload продолжают отдавать прямой Remnawave `subscriptionUrl`; `/api/sub/:token`, `/api/public/subscription-page/:token`, `/api/public-subscription/:token` и custom public page не возвращаются.
- `REMNAWAVE` и `LOCAL_SQUAD` взаимоисключающие.
- `meteredSquadUuid` при `LOCAL_SQUAD` обязан входить в `internalSquadUuids`.
- Для `LOCAL_SQUAD`: Remnawave `trafficLimitBytes=0`, `trafficLimitStrategy=NO_RESET`.
- Не создавать строку на каждый poll или на каждый день.
- Один `SquadTrafficQuota` на subscription; история только для значимых событий.
- Все байты хранятся как PostgreSQL `BIGINT`/Prisma `BigInt`, API сериализует их строками.
- Не сбрасывать текущий период при обычном продлении того же активного тарифа.

---

## File map

| Path | Action | Responsibility |
| --- | --- | --- |
| `backend/prisma/schema.prisma` | Modify | Limit modes, quota, grants, events, Remnawave identity snapshots. |
| `backend/prisma/migrations/20260719010000_squad_traffic_quota/migration.sql` | Create | Совместимая schema migration с default `REMNAWAVE`. |
| `backend/src/modules/squad-traffic/traffic-period.ts` | Create | Календарные границы, effective limit, пороги. |
| `backend/src/modules/squad-traffic/traffic-period.test.ts` | Create | Jan 31/leap year/renewal/grant math. |
| `backend/src/modules/squad-traffic/traffic-entitlement.service.ts` | Create | Создание/продление/смена quota, rollover, grants. |
| `backend/src/modules/squad-traffic/traffic-entitlement.service.test.ts` | Create | Lifecycle и идемпотентность. |
| `backend/src/modules/squad-traffic/squad-traffic.admin.routes.ts` | Create | Admin quota/grant/reconcile endpoints. |
| `backend/src/modules/squad-traffic/squad-traffic.client.ts` | Create | Безопасный client DTO текущего лимита. |
| `backend/src/app.ts` | Modify | Mount admin quota router. |
| `backend/src/modules/admin/admin.routes.ts` | Modify | Tariff/Trial schemas, CRUD и JSON. |
| `backend/src/modules/tariff/tariff-activation.service.ts` | Modify | Передать entitlement lifecycle в одну точку активации. |
| `backend/src/modules/client/client.routes.ts` | Modify | Отдать quota DTO кабинету. |
| `frontend/src/pages/tariffs.tsx` | Modify | Выбор режима и одного metered squad. |
| `frontend/src/pages/trials.tsx` | Modify | Независимый Trial limit mode. |
| `frontend/src/components/admin/subscription-remna-panel.tsx` | Modify | Quota status/actions в обычной карточке. |
| `frontend/src/pages/cabinet/client-dashboard.tsx` | Modify | Остаток и next reset пользователю. |
| `frontend/src/lib/api.ts` | Modify | Tariff/Trial/quota/grant DTO. |

### Task 1: Добавить строгую и ограниченную Prisma-модель

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260719010000_squad_traffic_quota/migration.sql`
- Modify: `backend/src/modules/subscription/subscription-schema.test.ts`

**Interfaces:**
- Produces: `TrafficLimitMode`, `TrafficQuotaStatus`, `TrafficQuotaGrantScope`, `TrafficQuotaGrantStatus`.
- Produces: `SquadTrafficQuota`, `TrafficQuotaGrant`, `TrafficQuotaEvent`.

- [ ] **Step 1: Добавить schema contract test**

Проверить exact names, unique subscription quota и отсутствие sample-history model.

```ts
assert.match(schema, /enum TrafficLimitMode[\s\S]*REMNAWAVE[\s\S]*LOCAL_SQUAD/);
assert.match(schema, /model SquadTrafficQuota[\s\S]*subscriptionId[\s\S]*@unique/);
assert.doesNotMatch(schema, /model TrafficUsageSample/);
```

- [ ] **Step 2: Добавить enums и поля**

```prisma
enum TrafficLimitMode {
  REMNAWAVE
  LOCAL_SQUAD
}

enum TrafficQuotaStatus {
  ACTIVE
  EXHAUSTED
  SUSPENDED
  CONFIG_ERROR
}

enum TrafficQuotaGrantScope {
  CURRENT_PERIOD
  WHILE_TARIFF_ACTIVE
}

enum TrafficQuotaGrantStatus {
  ACTIVE
  REVOKED
  EXPIRED
}
```

Добавить в `Tariff` и `Trial`:

```prisma
trafficLimitMode  TrafficLimitMode @default(REMNAWAVE) @map("traffic_limit_mode")
meteredSquadUuid  String?          @map("metered_squad_uuid")
```

Добавить в `Subscription`:

```prisma
remnawaveUsername  String? @map("remnawave_username")
remnawaveShortUuid String? @map("remnawave_short_uuid")
```

- [ ] **Step 3: Добавить bounded quota и grants**

```prisma
model SquadTrafficQuota {
  id                    String             @id @default(cuid())
  subscriptionId        String             @unique @map("subscription_id")
  tariffIdAtPeriodStart String?            @map("tariff_id_at_period_start")
  meteredSquadUuid      String             @map("metered_squad_uuid")
  baseLimitBytes        BigInt             @map("base_limit_bytes")
  usedBytes             BigInt             @default(0) @map("used_bytes")
  periodStartedAt       DateTime           @map("period_started_at")
  periodEndsAt          DateTime           @map("period_ends_at")
  notifiedPercents      Int[]              @default([]) @map("notified_percents")
  status                TrafficQuotaStatus @default(ACTIVE)
  exhaustedAt           DateTime?          @map("exhausted_at")
  lastAccountedAt       DateTime?          @map("last_accounted_at")
  createdAt             DateTime           @default(now()) @map("created_at")
  updatedAt             DateTime           @updatedAt @map("updated_at")
  subscription          Subscription       @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  grants                TrafficQuotaGrant[]
  events                TrafficQuotaEvent[]

  @@index([status, periodEndsAt])
  @@map("squad_traffic_quotas")
}

model TrafficQuotaGrant {
  id                 String                  @id @default(cuid())
  quotaId            String                  @map("quota_id")
  tariffIdAtGrant    String?                 @map("tariff_id_at_grant")
  scope              TrafficQuotaGrantScope
  status             TrafficQuotaGrantStatus @default(ACTIVE)
  bytes              BigInt
  validPeriodStartAt DateTime?               @map("valid_period_start_at")
  revokedAt          DateTime?               @map("revoked_at")
  createdAt          DateTime                @default(now()) @map("created_at")
  quota              SquadTrafficQuota       @relation(fields: [quotaId], references: [id], onDelete: Cascade)

  @@index([quotaId, status, scope])
  @@map("traffic_quota_grants")
}

model TrafficQuotaEvent {
  id            String            @id @default(cuid())
  quotaId       String            @map("quota_id")
  kind          String
  deltaBytes    BigInt?           @map("delta_bytes")
  usedBytes     BigInt            @map("used_bytes")
  limitBytes    BigInt            @map("limit_bytes")
  detail        Json?
  createdAt     DateTime          @default(now()) @map("created_at")
  quota         SquadTrafficQuota @relation(fields: [quotaId], references: [id], onDelete: Cascade)

  @@index([quotaId, createdAt(sort: Desc)])
  @@map("traffic_quota_events")
}
```

- [ ] **Step 4: Написать backward-compatible SQL migration**

Все существующие Tariff/Trial получают `REMNAWAVE`; quota rows не backfill-ятся. Индексы и FK создаются явно. Миграция не трогает composite tables.

- [ ] **Step 5: Проверить Prisma**

Run: `cd backend && npx prisma format && npx prisma validate && npx prisma generate`

Expected: все команды exit code 0.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260719010000_squad_traffic_quota/migration.sql backend/src/modules/subscription/subscription-schema.test.ts
git commit -m "feat: add bounded squad traffic quota model"
```

### Task 2: Реализовать календарный период и effective limit

**Files:**
- Create: `backend/src/modules/squad-traffic/traffic-period.ts`
- Create: `backend/src/modules/squad-traffic/traffic-period.test.ts`

**Interfaces:**
- Produces: `nextMonthlyBoundary(start: Date): Date`.
- Produces: `effectiveLimitBytes(base: bigint, grants: GrantInput[], tariffId: string | null, periodStart: Date): bigint`.
- Produces: `crossedRemainingPercents(previousUsed, nextUsed, limit): number[]`.

- [ ] **Step 1: Написать failing date/math tests**

```ts
test("clamps Jan 31 to leap-year February end", () => {
  assert.equal(nextMonthlyBoundary(new Date("2028-01-31T14:30:00.000Z")).toISOString(), "2028-02-29T14:30:00.000Z");
});

test("applies grants by lifecycle", () => {
  const limit = effectiveLimitBytes(100n, [
    { bytes: 10n, scope: "CURRENT_PERIOD", tariffIdAtGrant: "t1", validPeriodStartAt: new Date("2026-07-18T00:00:00Z") },
    { bytes: 20n, scope: "WHILE_TARIFF_ACTIVE", tariffIdAtGrant: "t1", validPeriodStartAt: null },
  ], "t1", new Date("2026-07-18T00:00:00Z"));
  assert.equal(limit, 130n);
});
```

- [ ] **Step 2: Реализовать UTC calendar clamp**

Не использовать `30 * 24h`. Сохранить день и время старта; установить следующий месяц; день ограничить последним днем целевого месяца.

- [ ] **Step 3: Реализовать grant filtering**

`CURRENT_PERIOD` применяется только при exact `validPeriodStartAt`; `WHILE_TARIFF_ACTIVE` — только при совпадении `tariffIdAtGrant` с текущим тарифом.

- [ ] **Step 4: Реализовать thresholds**

Возвращать пересеченные остатки `[50,25,10,3,0]` в этом порядке. `limit=0` означает unlimited и не пересекает пороги.

- [ ] **Step 5: Проверить**

Run: `cd backend && npx tsx --test src/modules/squad-traffic/traffic-period.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/squad-traffic/traffic-period.ts backend/src/modules/squad-traffic/traffic-period.test.ts
git commit -m "feat: calculate personal traffic periods"
```

### Task 3: Реализовать entitlement lifecycle и дополнительные гигабайты

**Files:**
- Create: `backend/src/modules/squad-traffic/traffic-entitlement.service.ts`
- Create: `backend/src/modules/squad-traffic/traffic-entitlement.service.test.ts`
- Modify: `backend/src/modules/tariff/tariff-activation.service.ts`

**Interfaces:**
- Produces: `applyTrafficEntitlement(subscriptionId, tariffOrTrial, reason, now?)`.
- Produces: `rolloverTrafficQuota(subscriptionId, now?)`.
- Produces: `grantTrafficBytes(subscriptionId, bytes, scope, actorId)`.
- Produces: `revokeTrafficGrant(grantId, actorId)`.

- [ ] **Step 1: Написать lifecycle tests**

Обязательные cases:

- новая покупка `LOCAL_SQUAD` создает quota `usedBytes=0`;
- продление того же активного тарифа не меняет `periodStartedAt`, `periodEndsAt`, `usedBytes`;
- наступивший `periodEndsAt` при оплаченной subscription открывает новый период;
- смена тарифа обнуляет quota и expire/revoke старые grants;
- `CURRENT_PERIOD` сгорает на rollover;
- `WHILE_TARIFF_ACTIVE` остается при продлении и удаляется при смене;
- `REMNAWAVE` удаляет/деактивирует локальный quota state.

- [ ] **Step 2: Реализовать central decision**

```ts
export type TrafficEntitlementInput = {
  tariffId: string | null;
  mode: "REMNAWAVE" | "LOCAL_SQUAD";
  internalSquadUuids: string[];
  meteredSquadUuid: string | null;
  trafficLimitBytes: bigint | null;
};
```

Валидировать metered squad до любого Remnawave write. Для локального режима обновлять того же user значениями `trafficLimitBytes: 0`, `trafficLimitStrategy: "NO_RESET"`.

- [ ] **Step 3: Подключить к одной точке успешной активации**

В `activateTariffForClient`, `extendSecondarySubscription` и ветках `activateTariffByPaymentId` вызывать один service после успешного Remnawave create/update и до финального success response. Не дублировать reset в auto-renew — он должен проходить через тот же activation service.

- [ ] **Step 4: Реализовать grants в транзакции**

Grant `CURRENT_PERIOD` получает `validPeriodStartAt=quota.periodStartedAt`; постоянный получает `tariffIdAtGrant`. Revoke меняет status, не удаляет строку, и пишет `TrafficQuotaEvent`.

- [ ] **Step 5: Проверить**

Run: `cd backend && npx tsx --test src/modules/squad-traffic/traffic-entitlement.service.test.ts src/modules/tariff/*.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/squad-traffic/traffic-entitlement.service.ts backend/src/modules/squad-traffic/traffic-entitlement.service.test.ts backend/src/modules/tariff/tariff-activation.service.ts
git commit -m "feat: manage squad traffic entitlements"
```

### Task 4: Интегрировать режим лимита в Tariff и Trial API

**Files:**
- Modify: `backend/src/modules/admin/admin.routes.ts`
- Modify: `backend/src/modules/client/client.routes.ts`
- Modify: `backend/src/modules/squad-traffic/squad-traffic.client.ts`
- Test: `backend/src/modules/squad-traffic/squad-traffic.admin.contract.test.ts`

**Interfaces:**
- Tariff/Trial DTO: `trafficLimitMode`, `meteredSquadUuid`, `trafficLimitBytes`, `trafficResetMode`.
- Client quota DTO: строковые byte values, ISO dates, status, percentages.

- [ ] **Step 1: Добавить Zod superRefine**

```ts
const trafficPolicySchema = z.object({
  trafficLimitMode: z.enum(["REMNAWAVE", "LOCAL_SQUAD"]),
  internalSquadUuids: z.array(z.string().uuid()).min(1),
  meteredSquadUuid: z.string().uuid().nullable(),
  trafficLimitBytes: z.number().int().nonnegative().nullable(),
}).superRefine((value, ctx) => {
  if (value.trafficLimitMode === "LOCAL_SQUAD" &&
      (!value.meteredSquadUuid || !value.internalSquadUuids.includes(value.meteredSquadUuid))) {
    ctx.addIssue({ code: "custom", path: ["meteredSquadUuid"], message: "Выберите учитываемый squad из назначенных" });
  }
});
```

- [ ] **Step 2: Применить правило ко всем CRUD paths**

Покрыть create/update/list/category nested tariff response, Trial create/update/list, копирование тарифа и внешнее API, если оно возвращает тарифы. Нельзя валидировать только frontend.

- [ ] **Step 3: Добавить безопасный client DTO**

```ts
type ClientTrafficQuota = {
  status: string;
  usedBytes: string;
  limitBytes: string;
  remainingBytes: string;
  remainingPercent: number;
  periodStartedAt: string;
  periodEndsAt: string;
};
```

- [ ] **Step 4: Проверить API contracts**

Run: `cd backend && npx tsx --test src/modules/squad-traffic/squad-traffic.admin.contract.test.ts`

Expected: PASS для valid Default+Whitelist/Whitelist и FAIL 400, если metered squad не назначен.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/admin/admin.routes.ts backend/src/modules/client/client.routes.ts backend/src/modules/squad-traffic/squad-traffic.client.ts backend/src/modules/squad-traffic/squad-traffic.admin.contract.test.ts
git commit -m "feat: expose tariff traffic modes"
```

### Task 5: Добавить admin quota actions и аудит

**Files:**
- Create: `backend/src/modules/squad-traffic/squad-traffic.admin.routes.ts`
- Modify: `backend/src/app.ts`
- Reuse: `backend/src/modules/audit/audit.service.ts`

**Interfaces:**
- `GET /api/admin/subscriptions/:id/traffic-quota`.
- `POST /api/admin/subscriptions/:id/traffic-grants` body `{bytes, scope}`.
- `POST /api/admin/traffic-grants/:id/revoke`.
- `POST /api/admin/subscriptions/:id/traffic-quota/suspend`.
- `POST /api/admin/subscriptions/:id/traffic-quota/resume`.

- [ ] **Step 1: Написать route authorization/validation tests**

Проверить auth, positive integer bytes, допустимый scope, subscription ownership existence и audit kinds.

- [ ] **Step 2: Реализовать тонкие routes**

Routes только валидируют input, вызывают entitlement service и `logAdmin(req, "traffic_quota.grant", ...)`. Бизнес-математику в routes не дублировать.

- [ ] **Step 3: Возвращать один detail payload**

Включить quota, active grants, последние 50 `TrafficQuotaEvent`, но не checkpoints и не Remnawave token.

- [ ] **Step 4: Mount router и проверить**

Run: `cd backend && npm test`

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/squad-traffic/squad-traffic.admin.routes.ts backend/src/app.ts backend/src/modules/squad-traffic/*.test.ts
git commit -m "feat: administer subscription traffic quotas"
```

### Task 6: Полностью интегрировать Tariff/Trial/admin/client UI

**Files:**
- Modify: `frontend/src/pages/tariffs.tsx`
- Modify: `frontend/src/pages/trials.tsx`
- Modify: `frontend/src/components/admin/subscription-remna-panel.tsx`
- Modify: `frontend/src/pages/cabinet/client-dashboard.tsx`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: traffic policy и quota/grant DTO этапа 2.

- [ ] **Step 1: Tariff form**

После выбора squad показать переключатель:

```text
Лимит Remnawave
Локальный лимит выбранного squad
```

При локальном режиме показать один select из `internalSquadUuids`, limit GB и read-only текст «ежемесячно от даты покупки». При Remnawave режиме сохранить текущие reset controls и не отправлять `meteredSquadUuid`.

- [ ] **Step 2: Trial form**

Добавить независимый mode/squad/limit. Не наследовать mode неявно: UI явно показывает «наследовать тариф» только если API имеет отдельное согласованное значение; иначе сохраняет конкретный snapshot.

- [ ] **Step 3: Admin subscription card**

Добавить used/limit/remaining, period dates, status, active grants, кнопки двух типов `+N ГБ`, revoke grant, suspend/resume. Оставить полный revoke обычной subscription отдельной опасной кнопкой.

- [ ] **Step 4: Client dashboard**

Показывать quota только для `LOCAL_SQUAD`: progress, GB, percent и точную дату reset. Для `REMNAWAVE` продолжить текущий Remnawave traffic display.

- [ ] **Step 5: Accessibility и build**

Все inputs имеют label, ошибки доступны текстом, mode controls работают с клавиатуры.

Run: `cd frontend && npm run build`

Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/tariffs.tsx frontend/src/pages/trials.tsx frontend/src/components/admin/subscription-remna-panel.tsx frontend/src/pages/cabinet/client-dashboard.tsx frontend/src/lib/api.ts
git commit -m "feat: integrate squad traffic limits in admin UI"
```

## Stage acceptance

- Existing tariffs/trials migrate as `REMNAWAVE` без изменения поведения.
- Admin может создать `Default + Whitelist` и выбрать только `Whitelist` для локального учета.
- Backend отклоняет metered squad вне выбранных squad.
- Один quota row на subscription; poll/sample rows отсутствуют.
- Персональные даты корректны для 28/29/30/31 числа.
- Оба типа `+N ГБ` работают и отзываются.
- Trial limit настраивается отдельно.
- Все admin/client views используют один обычный Remnawave user.

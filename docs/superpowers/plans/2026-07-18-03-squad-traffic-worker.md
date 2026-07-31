# Этап 3. API-брокер, учет, уведомления и enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пакетно получать статистику только нод выбранного squad, обновлять ограниченный локальный quota-state, уведомлять пользователя на 50/25/10/3/0% и при исчерпании удалять только metered squad.

**Architecture:** Один worker группирует активные quotas по `meteredSquadUuid`, автоматически получает accessible nodes и вызывает официальный Remnawave bulk endpoint. На subscription хранится одна checkpoint row с двумя переиспользуемыми дневными слотами; новый sample не вставляется. Все решения fail-open и сначала запускаются в observe-only.

**Tech Stack:** Node.js 22, TypeScript, node-cron, PostgreSQL/Prisma, existing Remnawave fetch transport, existing cron registry, existing Telegram sender.

## Global Constraints

- Минимальная Remnawave version: `2.8.0`.
- Пользовательские payload продолжают отдавать прямой Remnawave `subscriptionUrl`; traffic accounting не добавляет subscription proxy или custom page.
- Учитывать только nodes выбранного `meteredSquadUuid`; Default/EU nodes не включать в stats request.
- Admin не настраивает hosts, balancer pools или Node UUID вручную.
- Не выполнять HTTP request на каждого пользователя.
- Не создавать историю пятиминутных samples.
- Один `TrafficUsageCheckpoint` на subscription.
- Дневные buckets и `start/end` для stats API формировать в UTC; production preflight обязан подтвердить, что Remnawave instance агрегирует эти даты по UTC.
- При timeout, incomplete response, config error или truncated topUsers не менять usage и не отзывать squad.
- Enforcement выключен до успешной observe-only сверки этапа 4.
- Все byte calculations — `bigint`.

---

## File map

| Path | Action | Responsibility |
| --- | --- | --- |
| `backend/prisma/schema.prisma` | Modify | Bounded checkpoint и worker state. |
| `backend/prisma/migrations/20260719020000_squad_traffic_checkpoint/migration.sql` | Create | Unique checkpoint table. |
| `backend/src/modules/remna/remna.client.ts` | Modify | Bulk stats API и typed accessible-node parser. |
| `backend/src/modules/squad-traffic/traffic-usage.broker.ts` | Create | Resolve squad nodes, fetch complete bulk totals, reject truncation. |
| `backend/src/modules/squad-traffic/traffic-usage.broker.test.ts` | Create | EU exclusion, grouping, truncation, error cases. |
| `backend/src/modules/squad-traffic/traffic-accounting.service.ts` | Create | Delta/checkpoint/quota transaction и thresholds. |
| `backend/src/modules/squad-traffic/traffic-accounting.service.test.ts` | Create | Idempotency/day rollover/late data/concurrency. |
| `backend/src/modules/squad-traffic/traffic-notification.service.ts` | Create | Telegram 50/25/10/3/0. |
| `backend/src/modules/squad-traffic/traffic-enforcement.service.ts` | Create | Remove/restore only metered squad. |
| `backend/src/modules/squad-traffic/squad-traffic.worker.ts` | Create | 5-minute/urgent/rollover orchestration. |
| `backend/src/modules/squad-traffic/squad-traffic.worker.test.ts` | Create | Fail-open, observe-only, leader lock. |
| `backend/src/modules/diagnostics/cron-registry.ts` | Reuse | Standard run tracking. |
| `backend/src/modules/diagnostics/diagnostics.routes.ts` | Modify | Durable worker status. |
| `backend/src/index.ts` | Modify | Start one worker. |
| `frontend/src/pages/admin-diagnostics.tsx` | Modify | Worker health and resolved nodes read-only. |

### Task 1: Добавить одну bounded checkpoint row на subscription

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260719020000_squad_traffic_checkpoint/migration.sql`
- Modify: `backend/src/modules/subscription/subscription-schema.test.ts`

**Interfaces:**
- Produces: `TrafficUsageCheckpoint` unique by `subscriptionId`.
- Produces: `TrafficAccountingWorkerState` singleton для диагностики, не sample history.

- [ ] **Step 1: Добавить failing schema test**

```ts
assert.match(schema, /model TrafficUsageCheckpoint[\s\S]*subscriptionId[\s\S]*@unique/);
assert.match(schema, /currentDate[\s\S]*previousDate/);
assert.match(schema, /model TrafficAccountingWorkerState/);
assert.doesNotMatch(schema, /TrafficUsageSample/);
```

- [ ] **Step 2: Добавить checkpoint**

```prisma
model TrafficUsageCheckpoint {
  id                    String   @id @default(cuid())
  subscriptionId        String   @unique @map("subscription_id")
  squadUuid             String   @map("squad_uuid")
  currentDate           DateTime? @db.Date @map("current_date")
  currentObservedBytes  BigInt   @default(0) @map("current_observed_bytes")
  previousDate          DateTime? @db.Date @map("previous_date")
  previousObservedBytes BigInt   @default(0) @map("previous_observed_bytes")
  updatedAt             DateTime @updatedAt @map("updated_at")
  subscription          Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)

  @@index([squadUuid])
  @@map("traffic_usage_checkpoints")
}
```

Worker state хранит только last run metadata, а не историю запусков:

```prisma
model TrafficAccountingWorkerState {
  id              String   @id @default("singleton")
  lastStartedAt   DateTime? @map("last_started_at")
  lastSucceededAt DateTime? @map("last_succeeded_at")
  durationMs      Int?      @map("duration_ms")
  processedCount  Int       @default(0) @map("processed_count")
  changedCount    Int       @default(0) @map("changed_count")
  apiRequestCount Int       @default(0) @map("api_request_count")
  lastError       String?   @db.Text @map("last_error")
  observeOnly     Boolean   @default(true) @map("observe_only")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@map("traffic_accounting_worker_state")
}
```

- [ ] **Step 3: Создать SQL migration и validate**

Run: `cd backend && npx prisma format && npx prisma validate && npx prisma generate`

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260719020000_squad_traffic_checkpoint/migration.sql backend/src/modules/subscription/subscription-schema.test.ts
git commit -m "feat: add bounded traffic checkpoints"
```

### Task 2: Добавить typed Remnawave bulk API

**Files:**
- Modify: `backend/src/modules/remna/remna.client.ts`
- Create: `backend/src/modules/remna/remna-bulk-usage.test.ts`

**Interfaces:**
- Produces: `remnaGetSquadAccessibleNodeUuids(squadUuid): Promise<Result<string[]>>`.
- Produces: `remnaGetNodesUsersUsage(nodesUuids, start, end, topUsersLimit)`.

- [ ] **Step 1: Написать request/response tests**

Проверить method POST, UTC query `start/end/topUsersLimit`, body `{nodesUuids}`, parser `{username,total}`, отказ для negative/non-integer/unsafe-number total и malformed response error.

- [ ] **Step 2: Реализовать bulk transport через существующий remnaFetch**

```ts
export function remnaGetNodesUsersUsage(
  nodesUuids: string[],
  start: string,
  end: string,
  topUsersLimit: number,
) {
  const query = new URLSearchParams({ start, end, topUsersLimit: String(topUsersLimit) });
  return remnaFetch<{
    response: { topUsers: Array<{ username: string; total: number }> };
  }>(`/api/bandwidth-stats/nodes/users?${query}`, {
    method: "POST",
    body: JSON.stringify({ nodesUuids }),
  });
}
```

- [ ] **Step 3: Нормализовать accessible nodes**

Существующий `remnaGetSquadAccessibleNodes` оставить транспортом; новый parser извлекает UUID, удаляет дубли и сортирует. Пустой набор — config error, не zero usage.

- [ ] **Step 4: Проверить**

Run: `cd backend && npx tsx --test src/modules/remna/remna-bulk-usage.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/remna/remna.client.ts backend/src/modules/remna/remna-bulk-usage.test.ts
git commit -m "feat: fetch bulk Remnawave node usage"
```

### Task 3: Реализовать автоматический usage broker

**Files:**
- Create: `backend/src/modules/squad-traffic/traffic-usage.broker.ts`
- Create: `backend/src/modules/squad-traffic/traffic-usage.broker.test.ts`

**Interfaces:**
- Consumes: active quotas grouped by metered squad.
- Produces: `Map<subscriptionId, {todayBytes, yesterdayBytes}>` и resolved node diagnostics.

- [ ] **Step 1: Написать broker tests**

Обязательные cases:

- Default+Whitelist: вызывается accessible-nodes только для Whitelist group;
- bulk request содержит только Whitelist Node UUID;
- два tariffs с одним Whitelist squad дают одну пару today/yesterday requests;
- response length `=== topUsersLimit` → `TRUNCATED_RESPONSE`;
- отсутствующий username при полной выборке трактуется как zero;
- пустые nodes, timeout, malformed total → error без partial result.

- [ ] **Step 2: Вычислить безопасный limit**

```ts
const topUsersLimit = Math.max(100, activeUsernames.size * 2 + 50);
```

Если `topUsers.length >= topUsersLimit`, не применять весь group result. Не увеличивать limit бесконечно в retry-loop.

- [ ] **Step 3: Делать два дневных запроса на squad**

Отдельно запросить today и yesterday. Не запрашивать диапазон из двух дней: API возвращает суммарный `topUsers` и не позволяет надежно разделить поздние данные по дням.

- [ ] **Step 4: Сопоставить username локально**

Использовать сохраненный `Subscription.remnawaveUsername`. Quota без username получает `CONFIG_ERROR`; не делать fallback `GET user` на каждого клиента внутри worker.

- [ ] **Step 5: Проверить**

Run: `cd backend && npx tsx --test src/modules/squad-traffic/traffic-usage.broker.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/squad-traffic/traffic-usage.broker.ts backend/src/modules/squad-traffic/traffic-usage.broker.test.ts
git commit -m "feat: broker metered squad usage"
```

### Task 4: Применять delta и checkpoints одной транзакцией

**Files:**
- Create: `backend/src/modules/squad-traffic/traffic-accounting.service.ts`
- Create: `backend/src/modules/squad-traffic/traffic-accounting.service.test.ts`
- Reuse: `backend/src/modules/squad-traffic/traffic-period.ts`

**Interfaces:**
- Produces: `accountTrafficBatch(samples, now): AccountingResult`.
- Output events: crossed percents, exhausted subscription IDs, anomalies.

- [ ] **Step 1: Написать idempotency/day tests**

```ts
test("same observed totals do not add usage twice", async () => {
  await accountTrafficBatch([{ subscriptionId: "s1", date: "2026-07-18", observedBytes: 100n }], now);
  assert.equal((await quota("s1")).usedBytes, 0n); // первый sample — baseline

  await accountTrafficBatch([{ subscriptionId: "s1", date: "2026-07-18", observedBytes: 150n }], now);
  await accountTrafficBatch([{ subscriptionId: "s1", date: "2026-07-18", observedBytes: 150n }], now);
  assert.equal((await quota("s1")).usedBytes, 50n);
});
```

Также проверить: первый sample каждого нового checkpoint только фиксирует baseline; day shift current→previous; late yesterday delta; decreased source; unlimited quota; exhausted quota; crossing 50/25/10/3/0 in one sample.

- [ ] **Step 2: Реализовать positive delta**

Для каждого из двух date slots:

```text
delta = max(0, observed - saved)
```

Если slot для даты еще не инициализирован, сохранить observed как baseline и применить `delta=0`. Это не начислит трафик, накопленный до покупки/миграции. Если observed меньше saved, delta=0, checkpoint заменяется, создается `SOURCE_DECREASED` event. Не вычитать уже начисленное.

- [ ] **Step 3: Batch only changed rows**

Не вызывать `update` для unchanged totals. Измененные checkpoints и quotas обновлять в одной transaction; для 1000 users использовать `createMany`/parameterized `UPDATE ... FROM (VALUES ...)` вместо 1000 независимых transactions.

- [ ] **Step 4: Защитить concurrency**

Worker получает один advisory lock перед broker fetch/apply. Дополнительно quota update проверяет ожидаемый `updatedAt` или блокирует выбранные rows в transaction, чтобы manual grant/reset не потерялся.

- [ ] **Step 5: Проверить**

Run: `cd backend && npx tsx --test src/modules/squad-traffic/traffic-accounting.service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/squad-traffic/traffic-accounting.service.ts backend/src/modules/squad-traffic/traffic-accounting.service.test.ts
git commit -m "feat: account squad traffic idempotently"
```

### Task 5: Уведомления 50/25/10/3/0

**Files:**
- Create: `backend/src/modules/squad-traffic/traffic-notification.service.ts`
- Create: `backend/src/modules/squad-traffic/traffic-notification.service.test.ts`
- Reuse: `backend/src/modules/notification/telegram-notify.service.ts`

**Interfaces:**
- Produces: `notifyTrafficMilestones(subscriptionId, percents)`.
- Consumes: `sendTelegramToUser`.

- [ ] **Step 1: Написать notification tests**

Проверить ascending consumption order `50,25,10,3,0`, exact once, restart idempotency, missing telegramId skip с event, exhausted text содержит `periodEndsAt`.

- [ ] **Step 2: Резервировать threshold до send**

Атомарно добавить percent в `notifiedPercents`, только победивший worker отправляет сообщение. При Telegram error записать `NOTIFICATION_FAILED`; не откатывать usage/enforcement. Для ручного retry предусмотреть admin action на конкретное failed event, а не автоматический duplicate storm.

- [ ] **Step 3: Использовать существующий sender**

Не создавать второй Telegram HTTP client. Тексты содержат used/limit/remaining и для `0` — точную дату reset.

- [ ] **Step 4: Проверить**

Run: `cd backend && npx tsx --test src/modules/squad-traffic/traffic-notification.service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/squad-traffic/traffic-notification.service.ts backend/src/modules/squad-traffic/traffic-notification.service.test.ts
git commit -m "feat: notify squad traffic thresholds"
```

### Task 6: Удалять и восстанавливать только metered squad

**Files:**
- Create: `backend/src/modules/squad-traffic/traffic-enforcement.service.ts`
- Create: `backend/src/modules/squad-traffic/traffic-enforcement.service.test.ts`

**Interfaces:**
- Produces: `enforceExhaustedQuota(subscriptionId)`.
- Produces: `restoreMeteredSquad(subscriptionId)`.

- [ ] **Step 1: Написать squad preservation tests**

Input squads `[Default, Whitelist, Other]`; exhaust output `[Default, Other]`; restore output `[Default, Other, Whitelist]`; repeated calls idempotent.

- [ ] **Step 2: Всегда читать актуального Remnawave user**

Перед PATCH получить active squads через `remnaGetUser`. Не заменять список snapshot-ом тарифа: это могло бы удалить персонально выданный squad.

- [ ] **Step 3: PATCH одного user**

```ts
await remnaUpdateUser({
  uuid: subscription.remnawaveUuid,
  activeInternalSquads: currentSquads.filter((uuid) => uuid !== quota.meteredSquadUuid),
});
```

При restore добавить metered squad через `Set`. Не менять expireAt, HWID, traffic limit или другие squads.

- [ ] **Step 4: Fail-open**

Remnawave error оставляет quota `EXHAUSTED` с retryable enforcement event, но не помечает squad удаленным. Следующий worker повторяет. Для restore — аналогично.

- [ ] **Step 5: Проверить и commit**

Run: `cd backend && npx tsx --test src/modules/squad-traffic/traffic-enforcement.service.test.ts`

```bash
git add backend/src/modules/squad-traffic/traffic-enforcement.service.ts backend/src/modules/squad-traffic/traffic-enforcement.service.test.ts
git commit -m "feat: enforce metered squad quota"
```

### Task 7: Собрать worker, rollover и diagnostics

**Files:**
- Create: `backend/src/modules/squad-traffic/squad-traffic.worker.ts`
- Create: `backend/src/modules/squad-traffic/squad-traffic.worker.test.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/src/modules/diagnostics/diagnostics.routes.ts`
- Modify: `frontend/src/pages/admin-diagnostics.tsx`

**Interfaces:**
- Produces: `startSquadTrafficWorker()` и `runSquadTrafficAccounting({observeOnly})`.
- Reuses: `registerCron`, `wrapCronTick`.

- [ ] **Step 1: Написать orchestration tests**

Проверить один leader, broker error fail-open, normal 5m pass, urgent 1m selection ≤10%, rollover before accounting, observe-only no squad mutation, enforcement retry.

- [ ] **Step 2: Реализовать один minute cron**

Один cron `* * * * *` выполняет rollover/urgent каждый тик, а full pass — только если прошло 5 минут. Не регистрировать два конкурирующих cron над одной таблицей.

- [ ] **Step 3: Включить observe-only по умолчанию**

Хранить настройку в существующем `SystemSetting`, ключ `squad_traffic_enforcement_enabled=false`. Даже при false usage и notifications могут считаться, но remove/restore squad запрещены; exhausted показывается как `wouldEnforce`.

- [ ] **Step 4: Diagnostics**

Отдать last success/error/duration, active/exhausted/config errors, changed checkpoints, API requests, truncated responses, resolved nodes по squad, overshoot. Не отдавать token или user identifiers списком.

- [ ] **Step 5: Нагрузочный runnable check**

Создать `backend/src/scripts/benchmark-squad-accounting.ts`, генерирующий 1000 и 20,000 in-memory samples и измеряющий pure delta/threshold calculation. Acceptance: 20,000 calculations <1s локально; staging API+DB full pass <5s для 1,000 пользователей. Результат staging приложить в deployment notes этапа 4.

- [ ] **Step 6: Полная проверка**

Run: `cd backend && npm test && npm run build`

Run: `cd frontend && npm run build`

Expected: exit code 0.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/squad-traffic backend/src/modules/diagnostics/diagnostics.routes.ts backend/src/index.ts backend/src/scripts/benchmark-squad-accounting.ts frontend/src/pages/admin-diagnostics.tsx
git commit -m "feat: run squad traffic accounting worker"
```

## Stage acceptance

- Для одного metered squad выполняется не более двух bulk stats requests за full pass: today и yesterday.
- Default/EU Node UUID никогда не входят в Whitelist request.
- При 1000 subscriptions в checkpoint table не более 1000 rows.
- Unchanged users не создают DB writes.
- Повторный worker pass не начисляет delta повторно.
- 50/25/10/3/0 отправляются один раз за period.
- В observe-only ни один squad не изменяется.
- При enforcement исчерпание удаляет только Whitelist.
- Любая неполнота/ошибка источника приводит к fail-open и видимой диагностике.

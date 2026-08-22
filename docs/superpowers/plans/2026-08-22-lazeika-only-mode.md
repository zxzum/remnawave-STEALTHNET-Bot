# Lazeika-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Режим продления Lazeika-Only — после истечения подписки пользователь остаётся ACTIVE на изолированном squad/inbound с доступом только к Telegram и lazeika.xyz, 5 Mbit/s через tc, настраивается в админке.

**Architecture:** Переиспользует single-subscription модель, `Subscription.graceUntil` и существующий cron. Новый модуль `backend/src/modules/lazeika-only/` содержит: настройки+валидацию, Xray rules builder (pure), tc/systemd генератор (pure), SSH executor (spawn системного ssh), ресурсный setup/reconcile сервис над существующим remna.client. Admin router + карточка в settings.tsx. Кабинет/bot получают динамическое `{count}` через `/api/client/subscription`.

**Tech Stack:** Express + Zod + Prisma (SystemSetting key-value), node:test, spawn ssh (без новых зависимостей), React settings page.

**Spec:** docs/superpowers/specs/2026-08-22-lazeika-only-design.md

## Global Constraints

- Ветка `codex/lazeika-only-feature` (worktree `.worktrees/lazeika-only`), dirty-файлы основной ветки не трогаем.
- Никаких новых Prisma-моделей, новой «техподписки», нового крона.
- Приватный SSH-ключ — только env (`LAZEIKA_ONLY_SSH_*`), никогда в БД/логах/API.
- Команда ssh собирается argv-массивом из валидированных значений; никаких конкатенаций shell-строк.
- Тесты: `cd backend && npm test` (node:test). Все существующие тесты остаются зелёными.
- Продукт называется Лазейка ВПН; технические маркеры: `Lazeika-Only`, tag хостов `LAZEIKA_ONLY`.

---

### Task 1: Настройки (SystemSetting)

**Files:**
- Modify: `backend/src/modules/client/client.service.ts` (SYSTEM_CONFIG_KEYS ~line 96, loadSystemConfigFromDb ~line 964)
- Modify: `backend/src/modules/admin/admin.routes.ts` (PATCH /settings mapping ~line 4977)
- Modify: `backend/src/scripts/seed-system-settings.ts` (DEFAULTS)

**Interfaces:**
- Produces: `config.lazeikaOnlyEnabled/lazeikaOnlyDays/lazeikaOnlySquadUuid/lazeikaOnlyNodeUuid/lazeikaOnlySpeedMbit/lazeikaOnlyMessageTemplate` (+ legacy fallback на expired_grace_*) — потребляется Task 2,6,8.
- PATCH keys: `lazeikaOnlyEnabled`, `lazeikaOnlyDays`, `lazeikaOnlySpeedMbit`, `lazeikaOnlyNodeUuid`, `lazeikaOnlySquadUuid`, `lazeikaOnlyMessageTemplate`. При записи пишем и legacy-ключи теми же значениями.

Ключи БД: `lazeika_only_enabled`, `lazeika_only_days`, `lazeika_only_speed_mbit`, `lazeika_only_node_uuid`, `lazeika_only_squad_uuid`, `lazeika_only_profile_uuid`, `lazeika_only_resource_state`, `lazeika_only_message_template`.

Дефолты seed: enabled=false, days=7, speed=5, template из спецификации §5.3.

Валидация шаблона (в lazeika module, Task 4): не пустой, ≤1000 символов, единственный placeholder `{count}`, неизвестные `{...}` запрещены.

### Task 2: Grace-lifecycle (cron path)

**Files:**
- Modify: `backend/src/modules/subscription/single-subscription-lifecycle.service.ts` (`processExpiredSingleSubscriptionAccess`, line 93)
- Test: `backend/src/modules/subscription/single-subscription-lifecycle.service.test.ts`

Алгоритм для каждой истёкшей подписки:
1. config = getLazeikaConfig (enabled/days/squadUuid + readiness из resource_state.status === "READY").
2. Если graceUntil уже в будущем — НЕ пересчитывать (fixed).
3. allowGrace = enabled && days>0 && squadUuid && READY && expireAt+days > now.
4. Сначала Remna update (expireAt=graceUntil|expireAt, status ACTIVE|DISABLED, activeInternalSquads=[squad]|tariff squads, traffic NO_RESET/0 при grace, HWID сохранён); только при успехе — Prisma update graceUntil.
5. Истёкший grace (graceUntil <= now): Remna DISABLED, squads=[] (не оставлять тарифные), затем очистить graceUntil.

Тесты обновить под новый порядок (Remna до записи) + новые случаи: fixed graceUntil, выключенная функция, не READY.

### Task 3: Оплата во время grace

**Files:**
- Modify: `backend/src/modules/tariff/tariff-activation.service.ts` (mergeSquads line 377, primary path ~599/~694, secondary ~1022, DB updates ~751/~1080)
- Modify: `backend/src/modules/sync/sync.service.ts` (guard уже стоит на line 207 — проверить bulk paths)

- mergeSquads фильтрует managed squad (из config lazeikaOnlySquadUuid + legacy) из preserved.
- После успешного апдейта подписки в БД (обоих путях) — `graceUntil: null`.
- sync.service guard уже существует; добавить тот же skip в bulk-sync путь если он пишет сквады.

### Task 4: lazeika-only core (чистые функции + конфиг)

**Files:**
- Create: `backend/src/modules/lazeika-only/lazeika-only.config.ts`
- Create: `backend/src/modules/lazeika-only/xray-rules.ts`
- Test: `backend/src/modules/lazeika-only/xray-rules.test.ts`

`getLazeikaConfig()`: чтение настроек + resource_state JSON (парсинг безопасный), нормализация, legacy fallback.
`resourceStateSchema` (zod) + `emptyResourceState()`.

xray-rules.ts:
```ts
buildManagedInbound(tag: string, port: number): inbound object (vless+reality? нет — нейтральный vless tcp)
buildRoutingRules(inboundTag: string, blockOutboundTag = "BLOCK"): RoutingRule[]
// [ {inboundTag:[tag], domain:["geosite:telegram"], outbound:"DIRECT"},
//   {inboundTag:[tag], domain:["domain:lazeika.xyz"], outbound:"DIRECT"},
//   {inboundTag:[tag], outbound:blockOutboundTag} ]
applyLazeikaRules(config, tag, port): копия config с добавленным inbound+rules; ошибка если нет BLOCK outbound
validateMessageTemplate(text): {ok, error?, preview(count)}
```

### Task 5: tc/systemd generator + SSH executor

**Files:**
- Create: `backend/src/modules/lazeika-only/tc-script.ts`
- Create: `backend/src/modules/lazeika-only/ssh.executor.ts`
- Test: `backend/src/modules/lazeika-only/tc-script.test.ts`

tc-script.ts (pure): генерирует текст `/usr/local/sbin/lazeika-only-tc` + systemd unit. Свой pref 11000-11003, handle 1:10x, flower dst_port/src_port tcp/udp + ip6, police rate. Только clsact, root qdisc не трогаем. Валидация interface `/^[a-zA-Z0-9._-]{1,15}$/`, port 1..65535 != 22, speed int 1..1000.

ssh.executor.ts: `runSsh(nodeAddress, script)` → spawn("ssh", [BatchMode=yes, StrictHostKeyChecking=yes, UserKnownHostsFile=env, ConnectTimeout=10, -p envPort, user@host, "--", "bash -s"]) со stdin=script. Env: LAZEIKA_ONLY_SSH_PRIVATE_KEY_PATH (-i), _SSH_USER (root), _SSH_PORT (22), _SSH_KNOWN_HOSTS (обязателен). Ошибки — exit code+stderr (секретов нет).

### Task 6: Ресурсный setup/reconcile/verify/disable

**Files:**
- Create: `backend/src/modules/lazeika-only/lazeika-only.service.ts`
- Test: `backend/src/modules/lazeika-only/lazeika-only.service.test.ts`

Зависимости инжектятся одним объектом (remna функции + ssh run + state load/save) — тестируется с fake.

setup(input {nodeUuid, squadUuid|null, speedMbit}):
1. validate: remna configured, node существует/не disabled/address есть, порт свободен (не совпадает с другими inbound ноды), ручной squad без чужих inbounds.
2. snapshot node (activeConfigProfileUuid, activeInbounds) в state.previousNodeConfig.
3. профиль: найти по state.profileUuid иначе создать копию активного профиля ноды c именем `Lazeika-Only — <node.name>` + managed inbound (tag `LAZEIKA_ONLY_INBOUND_<short>`) + rules; PATCH/POST config-profiles; сохранить UUID.
4. применить ноду: remnaUpdateNode({uuid, activeConfigProfileUuid: managed, activeInbounds: [...старые, managedInboundUuid]}).
5. squad: ручной или по имени `Lazeika-Only`; создать при отсутствии; update inbounds=[managedInbound]; проверить accessible-nodes ⊆ {node}.
6. hosts: 1 рабочий (копия техпараметров рабочего host профиля, привязка к managed profile/inbound, tag LAZEIKA_ONLY) + 3 notification (.invalid адреса, isDisabled=true, remark по умолчанию, tags LAZEIKA_ONLY + NOTIFICATION). Не создавать дубликаты; reconcile не перезаписывает ручные поля кроме binding.
7. SSH/tc: install script+unit, apply filters.
8. status READY + timestamps в state; createdResourceUuids для rollback.

rollback при ошибке: восстановить ноду из snapshot, удалить созданные текущим запуском ресурсы (по UUID из createdResourceUuids), свои tc filters/unit, статус ERROR + phase.

verify: read-only проверки существования/соответствия + SSH `command -v tc` + наличие unit.
reconcile: setup по сохранённому state без создания дублей.
disable: enabled=false (настройку пишет роутер), инфраструктуру не трогает.

### Task 7: Admin API router

**Files:**
- Create: `backend/src/modules/lazeika-only/lazeika-only.routes.ts` (requireAuth+requireAdminSection, zod: uuid/string/int 1..1000)
- Modify: точка монтирования admin routers (найти где монтируются другие модульные роутеры)

GET /admin/lazeika-only/status, POST /admin/lazeika-only/setup, POST /admin/lazeika-only/verify, POST /admin/lazeika-only/reconcile, POST /admin/lazeika-only/disable.

### Task 8: Кабинет/bot сообщение

**Files:**
- Modify: `backend/src/modules/client/client.routes.ts` (GET /subscription line 3225) — добавить `lazeikaOnly?: {active, daysLeft, message}` когда isActiveSubscriptionGrace.
- Modify: frontend cabinet отображение (файл найдётся по usage /api/client/subscription).

{count} = max(1, ceil((graceUntil-now)/24h)).

### Task 9: Фронтенд админки

**Files:**
- Modify: `frontend/src/lib/api.ts` (типы LazeikaOnlyStatus + методы getStatus/setup/verify/reconcile/disable)
- Modify: `frontend/src/pages/settings.tsx` (карточка «Lazeika-Only — режим продления» вместо/рядом с legacy-карточкой; toggle/days/speed/node select/squad select+auto/template+preview/status/error/buttons/link hosts editor)
- Modify: payload в handleSubmit + AdminSettings тип.

### Task 10: Тесты

Unit: xray-rules (allow/block построение, отсутствие BLOCK → error, уникальность tag/port, template validation), tc-script (команды, запрет SSH порта, валидация args), lifecycle (новый порядок), settings fallback.
Integration (fake remna+ssh): setup с чистого листа; повторный setup без дублей; чужой inbound в ручном squad → reject; rollback после сбоя profile/SSH; reconcile восстанавливает удалённое; READY повторно.

Run: `cd backend && npm test`.

### Task 11: Deployment docs

Modify: `docs/runbooks/` (или DEPLOYMENT.md) — секция Lazeika-Only: SSH env vars, монтирование ключа/known_hosts, root/cap_net_admin для tc, systemd+tc требования, MVP агрегированный лимит, порядок удаления.

# Возврат прямых Remnawave-подписок

## Цель

Вернуть систему подписок к одному обычному Remnawave user на каждую локальную `Subscription`. Во всех пользовательских интерфейсах должна использоваться прямая ссылка Remnawave вида `https://sub.lazeika.xyz/<short-id>`. STEALTHNET больше не проксирует и не объединяет конфигурации через `/api/sub/:token`, фактический JSON route `/api/public/subscription-page/:token` или прежний alias `/api/public-subscription/:token`.

Оригинальный репозиторий `systemmaster1200-eng/remnawave-STEALTHNET-Bot` используется только как эталон прежнего потока `remnaGetUser() -> subscriptionUrl`. Текущий проект не откатывается: все изменения, не относящиеся к composite subscriptions, должны сохраниться.

## Последовательность внедрения

Работа выполняется по этапам 01–04. Production-конвертация пользователей запускается только после внедрения и проверки новой single-subscription системы.

1. Удалить composite runtime и перевести все операции на один `Subscription.remnawaveUuid`.
2. Внедрить локальную модель squad quota и административные настройки.
3. Внедрить traffic worker, уведомления и fail-open enforcement.
4. Выполнить resumable cutover всех существующих подписок и удалить legacy composite schema/data только после успешной проверки.

## Runtime после этапа 01

- Покупка, Trial, подарок, продление, конвертация тарифа и дополнительные опции создают или обновляют не более одного Remnawave user на локальную подписку.
- Enable, disable, revoke, HWID, squads и traffic settings применяются только к `Subscription.remnawaveUuid`.
- Клиентский API, кабинет, Telegram-бот, подарки и уведомления получают `subscriptionUrl` непосредственно из ответа Remnawave.
- Маршруты `/api/sub/:publicSubscriptionToken`, `/api/public/subscription-page/:publicSubscriptionToken` и `/api/public-subscription/:publicSubscriptionToken`, их custom browser page и composite merge удаляются.
- `publicSubscriptionToken` не участвует в runtime и удаляется вместе с legacy composite schema на этапе 04, если поиск зависимостей не обнаружит другого обязательного назначения.
- Legacy component rows остаются read-only до завершения cutover, чтобы миграция могла найти и безопасно удалить старых Remnawave users.

## Конвертация всех существующих подписок

Этап 04 принудительно обрабатывает все локальные подписки, включая `ACTIVE` и `EXPIRED`. Удалённые или tombstone-записи не восстанавливаются.

Для каждой подписки migration script:

1. Читает локальный тариф или Trial, срок, squads, traffic limit/reset, HWID limit и дополнительные оплаченные параметры.
2. Формирует один canonical Remnawave payload. Источником тарифа и оплаченных опций служит локальная БД, а не один из component users.
3. В dry-run показывает решение без изменений. Мутации разрешены только с явным `--apply`.
4. Создаёт нового обычного Remnawave user даже если прежняя подписка уже была single, чтобы конвертация гарантированно охватила всех.
5. Сохраняет исходные `createdAt` и `expireAt`. Истёкшая подписка остаётся истёкшей и не получает дополнительного времени.
6. Получает созданного user обратно через Remnawave API и проверяет UUID, тарифные параметры и прямой `subscriptionUrl` на домене `sub.lazeika.xyz`.
7. Только после проверки атомарно переключает `Subscription.remnawaveUuid`; для primary subscription синхронизирует legacy `Client.remnawaveUuid`.
8. После подтверждённого переключения удаляет старого primary/component users. До этого старые users остаются доступными для rollback.

Migration script возобновляется по `Subscription.id` и пишет durable state в существующий `AdminEvent`. Ошибка одной записи не переключает её UUID и не мешает продолжить или повторить миграцию остальных.

## Лимиты и тарифы

- Формула `computeConvertedDays()` не меняется и не дублируется.
- Для `REMNAWAVE` новый user получает обычный глобальный traffic limit/reset оплаченного тарифа.
- Для `LOCAL_SQUAD` новый user получает `trafficLimitBytes=0` и `NO_RESET`; локальный quota state создаётся согласно этапам 02–03.
- Active subscription сохраняет оставшийся оплаченный срок.
- Expired subscription сохраняет прежний `expireAt` и статус `EXPIRED`.
- При отсутствии однозначного тарифа или обязательного параметра запись помечается ошибкой и не переключается; migration script не угадывает значения.

## Безопасность cutover

- Перед `--apply` обязательны backup обеих PostgreSQL databases и deployment directory.
- Старые Remnawave users не удаляются до проверки нового user и прямой ссылки.
- Повторный запуск идемпотентен и не создаёт второй replacement после уже зафиксированного шага.
- После apply выполняется полная сверка каждой локальной подписки с новым Remnawave user.
- Отдельно проверяется, что все пользовательские payloads содержат прямой Remnawave URL и нигде не содержат `/api/sub/`, `/api/public/subscription-page/` или `/api/public-subscription/`.
- Legacy component tables удаляются только после успешной полной сверки.

## Проверка

- Source-contract запрещает component operations и оба proxy route во всём runtime.
- Targeted tests проверяют прямой `subscriptionUrl` для кабинета, Trial, подарка, уведомлений и revoke/reissue.
- Lifecycle tests подтверждают ровно один Remnawave API target на subscription.
- Migration tests покрывают active, expired, Trial, paid tariff, local quota, resume, retry и запрет раннего удаления старых users.
- Перед production cutover проходят backend tests/build и frontend build.
- Production smoke проверяет прямой URL в VPN-клиенте и браузере, enable/disable/revoke, покупку/продление и соответствие нового user оплаченному тарифу.

## Вне области изменений

Не откатываются и не переписываются unrelated fixes: платежи, подарки, Trial, HWID, автопродление, Telegram support, административный интерфейс, nginx и другие функции сохраняются, кроме минимальных точечных изменений, необходимых для удаления composite subscription runtime.

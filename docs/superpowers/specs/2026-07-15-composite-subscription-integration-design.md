# Интеграция составных подписок в trial и админские операции

Дата: 2026-07-15  
Ветка: `feature/composite-subscriptions`

## Цель

Все операции STEALTHNET над подпиской должны работать с логической `Subscription`
и всеми её `RemnawaveComponent`, а не только с legacy
`Subscription.remnawaveUuid`. Раздел `Триалы` должен позволять копировать
компоненты выбранного тарифа и независимо редактировать полученный snapshot.

Критический пользовательский сценарий:
`Клиенты → Редактировать клиента → Подписки`. В нём загрузка данных, изменение
лимитов и Squad, enable, disable, revoke, reset traffic, работа с устройствами,
статистикой и unlink должны корректно учитывать все компоненты подписки.

## Выбранный подход

Переиспользуются существующие модели `TrialRemnawaveComponent`,
`TariffRemnawaveComponent`, `RemnawaveComponent` и существующий
`subscription-components.service.ts`. Новый параллельный service layer и новые
таблицы override не создаются.

`Subscription.remnawaveUuid` и `Client.remnawaveUuid` временно остаются зеркалом
обязательного компонента для обратной совместимости. Новые операции не используют
их как единственный источник компонентов.

## Trial как независимый snapshot

При выборе тарифа в форме trial его enabled-компоненты копируются в
`TrialRemnawaveComponent`. После копирования trial не зависит от будущих изменений
тарифа. Администратор может:

- менять название, key, порядок и обязательность компонента;
- выбирать Squad;
- задавать собственный traffic limit и reset mode;
- управлять отображением квоты;
- добавлять, отключать и удалять компоненты.

В trial должен оставаться ровно один enabled-компонент `required=true`, keys и
`mergeOrder` должны быть уникальными. Включённый компонент должен иметь хотя бы
один Squad.

Для trial без тарифа используется тот же редактор и та же модель. Legacy-поля
`squadUuids` и `trafficLimitBytes` сохраняются только как совместимый fallback,
если snapshot ещё отсутствует.

## Миграция существующих trial

Миграция копирует компоненты тарифа во все существующие trial с `tariffId`, у
которых ещё нет `TrialRemnawaveComponent`. Повторный запуск безопасен благодаря
уникальному `(trialId, key)` и не перезаписывает уже отредактированные snapshots.

Во всех существующих trial snapshots, созданных этим backfill, компонент с key
`whitelist` получает лимит `5 * 1024 * 1024 * 1024` bytes. Обязательный
`primary` сохраняет безлимитный traffic limit. После миграции значения каждого
trial независимо редактируются в админке. Это одноразовая настройка данных;
runtime-логика не содержит ветвлений по имени `whitelist`.

## Активация trial

Активация создаёт логическую подписку, сохраняет её связь с `trialId`, а затем
материализует Remnawave-компоненты из snapshot trial. Синхронизация не должна
происходить до сохранения `trialId`, иначе сервис видит только тариф и теряет
trial overrides.

Каждый materialized-компонент получает свои Squad, traffic limit и reset mode.
Общий срок и HWID limit применяются ко всем компонентам. Сбой обязательного
компонента завершает активацию ошибкой; сбой необязательного компонента переводит
подписку в `PENDING` для reconciliation, не отменяя успешно созданную логическую
подписку.

## Единые операции над подпиской

`subscription-components.service.ts` является единственной точкой выбора целей
операции. Legacy-подписка без materialized-компонентов представляется одним
обязательным fallback-компонентом.

Операции распределяются так:

- enable, disable, revoke и reset traffic применяются ко всем компонентам;
- expireAt, логический статус и HWID limit применяются ко всей подписке и всем
  компонентам;
- traffic limit, reset mode и Squad редактируются у конкретного компонента и
  сохраняются в его snapshot;
- devices загружаются со всех компонентов, дедуплицируются по HWID и сохраняют
  сведения об источниках;
- удаление HWID удаляет его со всех компонентов, где он найден;
- usage загружается по всем компонентам и возвращается как component series плюс
  агрегированный итог;
- unlink очищает UUID всех компонентов и legacy-зеркала, не оставляя частично
  привязанную подписку;
- delete/revoke и reconciliation используют те же общие операции.

Частичный сбой необязательного компонента возвращается как `degraded`, сохраняет
`syncStatus=PENDING`, `syncError` и retry time. Сбой обязательного компонента
возвращает ошибочный HTTP status.

## Админка клиентов

Экран `Клиенты → Редактировать клиента → Подписки` работает с одним DTO логической
подписки. DTO содержит:

- данные `Subscription`;
- канонический public subscription URL;
- упорядоченный список компонентов и их состояние;
- агрегированные устройства, traffic и sync status.

В обзоре показывается логическая подписка и статусы её компонентов. Формы traffic
и Squad работают с выбранным компонентом. Общие действия запускаются для всей
подписки. UI отображает degraded/partial failures по именам компонентов вместо
ложного сообщения об общем успехе.

Upstream subscription URL и UUID необязательных компонентов не выдаются
пользовательским API. В защищённом admin DTO UUID допустимы для диагностики, но
копируемая ссылка всегда является объединённой public subscription URL.

## Канонический URL подписки

Публичный формат ссылки:

```text
https://<current-domain>/api/sub/:publicSubscriptionToken
```

Домен `bot.lazeika.xyz` не хардкодится. Все backend DTO, кабинет, админка, бот,
trial, gift и уведомления используют существующий `buildPublicSubscriptionUrl`.
Базовый URL берётся из `publicAppUrl`; в HTTP-контексте допустим fallback на
origin запроса с учётом доверенных proxy headers.

После изменения `publicAppUrl` все заново загруженные и отправленные ссылки
автоматически используют новый домен. `publicSubscriptionToken` не меняется.

## Аудит остальных потоков

Проверяются все прямые операции с `Subscription.remnawaveUuid`,
`Client.remnawaveUuid`, `remnaGetUser`, `remnaUpdateUser`, lifecycle actions,
devices, Squad, traffic и subscription URL. В область входят:

- client-level и subscription-level admin routes;
- bulk actions;
- bot-admin routes;
- trial и gift activation;
- tariff activation, renewal, conversion и extras;
- promo/free-days;
- sync, reconciliation, expiry/grace и deletion;
- кабинет, бот и уведомления.

Legacy-маршруты сохраняются только как совместимые адаптеры: они сначала
разрешают логические подписки клиента, затем вызывают общий component-service.

## Проверки

Минимальный набор regression-проверок:

1. Trial из тарифа получает независимый snapshot всех компонентов.
2. Существующий trial backfill-ится без перезаписи уже созданных компонентов.
3. Текущий trial материализует unlimited `primary` и `whitelist` с 5 GiB.
4. Активация сохраняет `trialId` до component synchronization.
5. Enable, disable, revoke и reset traffic вызываются для двух компонентов.
6. Component traffic/Squad edit не изменяет соседний компонент.
7. Common expireAt/HWID edit применяется ко всем компонентам.
8. Devices и usage агрегируются; HWID удаляется со всех источников.
9. Unlink очищает components и legacy mirrors.
10. Экран редактирования клиента использует logical subscription DTO и показывает
    component-level ошибки.
11. Все выдаваемые ссылки имеют `/api/sub/:token` и меняют host вместе с
    `publicAppUrl`.
12. Поиск по коду не оставляет runtime-пути, которые выполняют операцию подписки
    только по legacy UUID, кроме явно документированных compatibility adapters.

## Вне области

- удаление legacy UUID-полей из базы;
- изменение формата public token;
- создание отдельного доменного сервиса для trial;
- автоматическое обновление snapshots trial после последующих изменений тарифа.

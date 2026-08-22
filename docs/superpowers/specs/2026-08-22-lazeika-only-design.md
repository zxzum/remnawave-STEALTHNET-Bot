# Техническое задание: Lazeika-Only — режим продления подписки

Статус: согласованная архитектура, готова к реализации  
Дата: 2026-08-22  
Продукт: Лазейка ВПН  
Ветка реализации: отдельная ветка с префиксом codex/, без работы в main

## 1. Цель

После окончания оплаченной подписки пользователь не должен сразу терять весь доступ. На ограниченный срок он переводится в режим продления Lazeika-Only:

- Remnawave-пользователь остаётся в статусе ACTIVE;
- пользователь получает обычный внутренний squad Lazeika-Only;
- доступ идёт только через выбранную администратором ноду;
- разрешены только Telegram и lazeika.xyz со всеми поддоменами и mini-app;
- весь остальной трафик блокируется;
- скорость ограничивается до 5 Mbit/s для трафика этого режима;
- срок режима настраивается глобально в админ-панели, по умолчанию 7 дней;
- после оплаты обычные тарифные настройки и squad автоматически восстанавливаются.

Функция должна использовать существующую модель single-subscription и существующий cron истечения подписок. Новую локальную «техническую подписку», новый тариф или отдельную Prisma-модель создавать не нужно.

## 2. Итоговая архитектура

### 2.1. Squad

Lazeika-Only — обычный внутренний squad Remnawave, не скрытый и не специального типа.

Правила выбора:

1. Администратор может выбрать существующий squad вручную.
2. Если squad вручную не выбран, система ищет обычный internal squad с точным техническим именем Lazeika-Only.
3. Если squad не найден, система создаёт его один раз.
4. UUID выбранного или созданного squad сохраняется в настройках.
5. Если найдено несколько squad с одинаковым именем, автоматическая настройка останавливается с понятной ошибкой и требует ручного выбора UUID.
6. Автоматически созданный squad не удаляется при выключении функции. Это защищает пользователей от потери инфраструктуры и позволяет повторно включить режим.
7. Ручной squad нельзя молча перехватить. Перед использованием он должен быть пустым либо содержать только управляемый Lazeika-Only inbound. Если в нём есть другие inbounds, setup завершается ошибкой без изменения squad.

Squad должен содержать только Lazeika-Only inbound. Иначе Remnawave выдаст пользователю доступ к дополнительным inbounds.

### 2.2. Отдельный Remnawave config-профиль

Для режима создаётся отдельный config-профиль Remnawave. Это не отдельный inbound, добавленный в произвольный существующий профиль.

Безопасный алгоритм:

- взять текущий активный профиль выбранной ноды;
- создать его независимую копию с именем Lazeika-Only — <имя ноды>;
- сохранить все существующие рабочие inbounds и настройки Xray;
- добавить в копию один управляемый inbound с уникальным tag и свободным портом;
- применить новый профиль к выбранной ноде;
- сохранить прежние activeInbounds и добавить к ним Lazeika-Only inbound;
- не удалять и не менять рабочие inbounds обычной подписки.

Так обычные пользователи сохраняют доступ, а Lazeika-Only получает собственную изолированную точку входа и собственные правила маршрутизации.

Сгенерированные hosts должны ссылаться именно на новый профиль:

- inbound.configProfileUuid = UUID Lazeika-Only профиля;
- inbound.configProfileInboundUuid = UUID Lazeika-Only inbound.

В Remnawave внутренние squad выбирают inbounds, а доступные ноды вычисляются из нод, на которых этот inbound активен. Поэтому отдельный API-вызов «подключить squad к ноде» не нужен: нужная доступность достигается активацией управляемого inbound только на выбранной ноде.

### 2.3. Hosts

После setup должны существовать:

1. Один рабочий host:
   - привязан к Lazeika-Only профилю и inbound;
   - направляет пользователя на выбранную ноду;
   - доступен для подключения.
2. Три notification-host:
   - привязаны к тому же профилю и inbound;
   - отключены или используют зарезервированный несуществующий адрес;
   - не должны создавать рабочий маршрут;
   - попадают в подписку как визуальные строки с уведомлением.

По умолчанию notification-host получают безопасные адреса из зоны .invalid и понятные remark. Администратор может редактировать их через существующий редактор hosts. Автоматизация не должна при повторном reconcile перезаписывать вручную изменённые remark, address, SNI, path и tags, кроме полей связи с управляемым профилем/inbound.

Рекомендуемые значения по умолчанию:

- notification-host 1: «🔐 Доступ к lazeika.xyz и Telegram»;
- notification-host 2: «⏰ Ваша подписка закончилась!»;
- notification-host 3: «✅ Доступ сохранён ещё на {count} дней. Продлите подписку!».

Важно: remark host является общим для всех пользователей. Поэтому динамическое значение {count} нельзя надёжно подставлять в глобальный Remnawave host для каждого пользователя. Динамическое уведомление должно формироваться в локальном кабинете и Telegram-уведомлении на основании graceUntil. В raw Remnawave-подписке остаются статические notification-host с текстом режима.

## 3. Сетевые правила Lazeika-Only

### 3.1. Xray routing

Управляемый inbound должен иметь отдельный tag, например LAZEIKA_ONLY_INBOUND_<короткий UUID>, и порт, свободный на выбранной ноде.

Для этого inbound в конфигурацию Xray добавляются правила с ограничением по inboundTag:

1. Разрешить Telegram:
   - использовать существующий поддерживаемый в проекте matcher geosite:telegram;
   - сохранить TCP и UDP.
2. Разрешить домен lazeika.xyz:
   - использовать domain:lazeika.xyz;
   - правило должно покрывать lazeika.xyz и все поддомены;
   - не ограничивать mini-app отдельным списком, если он использует поддомены lazeika.xyz.
3. Заблокировать всё остальное через существующий outbound BLOCK.

Правила должны применяться только к Lazeika-Only inbound. Запрещено менять глобальный routing для остальных inbounds.

Если текущий Xray-профиль не поддерживает geosite:telegram, setup должен завершиться ошибкой с указанием причины. Нельзя молча заменить allowlist на слишком широкий matcher.

### 3.2. Ограничение скорости через SSH и tc

Backend подключается к выбранной ноде по SSH и устанавливает server-side ограничение только для трафика Lazeika-Only inbound.

Обязательные свойства:

- скорость по умолчанию: 5 Mbit/s;
- ограничение агрегированное для всего Lazeika-Only inbound на ноде, а не отдельные 5 Mbit/s на каждого пользователя;
- ограничить входящий трафик по destination port управляемого inbound;
- ограничить исходящий трафик по source port управляемого inbound;
- учесть TCP и UDP;
- учесть IPv4 и IPv6;
- использовать qdisc clsact и управляемые flower/police filters;
- удалять и обновлять только filters с собственными pref/handle;
- не заменять root qdisc;
- не менять системный firewall целиком;
- не менять порт или настройки SSH;
- не ограничивать Remnawave API, Docker, systemd и другой служебный трафик;
- после перезагрузки ноды автоматически переустанавливать filters через systemd unit/timer.

Порт inbound должен быть уникальным. Если он уже используется другим Xray inbound или не удаётся определить реальный внешний интерфейс, setup должен остановиться без включения режима.

Для Docker/bridge-схемы нужно определить интерфейс и порт, на котором виден внешний трафик. Если это невозможно безопасно проверить, система не должна применять ограничение ко всему интерфейсу. Она должна вернуть ошибку «топология ноды не поддерживается автоматически».

SSH-ключ:

- хранится только в окружении backend или в смонтированном secrets-файле;
- в SystemSetting, Prisma и админ API приватный ключ не сохраняется;
- использовать отдельные параметры окружения:
  - LAZEIKA_ONLY_SSH_PRIVATE_KEY_PATH;
  - LAZEIKA_ONLY_SSH_USER, по умолчанию root;
  - LAZEIKA_ONLY_SSH_PORT, по умолчанию 22;
  - LAZEIKA_ONLY_SSH_KNOWN_HOSTS;
- использовать BatchMode=yes, ConnectTimeout и строгую проверку known_hosts;
- не разрешать парольный SSH в MVP;
- все аргументы ноды, порта и скорости валидировать до запуска SSH;
- не собирать удалённую команду конкатенацией непроверенных строк.

## 4. Пользовательское состояние и переходы

Использовать уже существующее поле Subscription.graceUntil.

~~~mermaid
stateDiagram-v2
    NORMAL_ACTIVE --> GRACE_ACTIVE: expireAt наступил и Lazeika-Only READY
    NORMAL_ACTIVE --> DISABLED: expireAt наступил и setup недоступен
    GRACE_ACTIVE --> NORMAL_ACTIVE: успешная оплата/продление
    GRACE_ACTIVE --> DISABLED: graceUntil наступил
    GRACE_ACTIVE --> DISABLED: функция выключена
~~~

### 4.1. Вход в режим

Существующий subscription-maintenance.cron продолжает запускаться каждые 5 минут. Новый параллельный cron для истечения подписок создавать нельзя.

Для каждой истёкшей подписки:

1. Проверить включение функции.
2. Проверить готовность инфраструктуры Lazeika-Only.
3. Вычислить graceUntil = исходный expireAt + количество дней из настроек.
4. Если graceUntil уже записан и находится в будущем, не пересчитывать его при каждом запуске.
5. Выполнить один Remnawave update:
   - expireAt = graceUntil;
   - status = ACTIVE;
   - activeInternalSquads = [lazeikaOnlySquadUuid];
   - сохранить исходный HWID device limit тарифа;
   - trafficLimitBytes = 0;
   - trafficLimitStrategy = NO_RESET;
   - не выполнять обычный tariff traffic reset.
6. Только после успешного ответа Remnawave записать graceUntil в Prisma и syncStatus = SYNCED.
7. После ошибки Remnawave не записывать graceUntil, чтобы следующий запуск мог безопасно повторить операцию.

Если функция выключена, срок равен 0, squad не настроен или инфраструктура не READY, пользователь переводится в DISABLED по существующей логике. Частично настроенная инфраструктура не должна выдавать пользователю полный доступ.

### 4.2. Окончание режима

Когда graceUntil наступил:

- установить Remnawave status = DISABLED;
- убрать Lazeika-Only squad;
- не оставлять рабочий тарифный squad у истёкшей подписки;
- после успешного update очистить graceUntil либо оставить его только как историческое значение по существующей модели, но функция isActiveSubscriptionGrace должна вернуть false;
- записать результат в журнал и счётчик maintenance.

### 4.3. Изменение глобального количества дней

Изменение количества дней влияет только на новые входы в режим. Уже выданный доступ заканчивается по сохранённому graceUntil.

Это исключает неожиданное продление или досрочное отключение пользователей при изменении настройки с 7 на другое значение.

### 4.4. Оплата во время Lazeika-Only

Успешная покупка, продление или смена тарифа должны:

1. определить, что пользователь находится в grace;
2. удалить управляемый Lazeika-Only squad из списка сохраняемых squad;
3. не сохранить его как «чужой» squad через mergeSquads;
4. применить обычные tariff internalSquadUuids;
5. восстановить обычные traffic settings;
6. восстановить обычный HWID limit с учётом extra devices;
7. установить новое tariff expireAt;
8. после успешного Remnawave update очистить graceUntil;
9. обновить локальную Subscription.

Общие sync, bulk sync, extra devices, ручной admin patch и другие пути обновления пользователя не должны перезаписывать активный grace-состояние. Пока grace активен, такие операции должны либо пропускаться с логом, либо возвращать контролируемый конфликт. Единственное исключение — явная операция оплаты/восстановления.

## 5. Настройки админ-панели

Использовать существующую модель SystemSetting и существующий PATCH /admin/settings. Новую таблицу для настроек не добавлять.

### 5.1. Публичные поля настроек

Добавить в существующий раздел настроек:

- Включить режим Lazeika-Only: boolean, default false;
- Доступ после окончания, дней: integer 1..365, default 7;
- Скорость Lazeika-Only: integer 1..1000 Mbit/s, default 5;
- Нода: select из Remnawave nodes;
- Squad: select из обычных Remnawave internal squads, плюс вариант «Автоматически создать Lazeika-Only»;
- Статус инфраструктуры: UNCONFIGURED, APPLYING, READY, ERROR;
- Кнопки «Настроить», «Проверить», «Перенастроить»;
- ссылка «Редактировать hosts уведомления» на существующий редактор Remnawave hosts с фильтром/тегом LAZEIKA_ONLY;
- предпросмотр сообщения для пользователя.

При сохранении обычных полей настройки не выполнять SSH и массовые изменения Remnawave автоматически. Для побочных действий нужна отдельная кнопка «Настроить»/«Применить».

### 5.2. Совместимость с существующими expired grace keys

В проекте уже есть expired_grace_enabled, expired_grace_days и expired_grace_squad_uuid. Использовать их как legacy-алиасы, чтобы не сломать текущие установки:

- lazeikaOnlyEnabled имеет приоритет, если задан;
- иначе читается expired_grace_enabled;
- lazeikaOnlyDays имеет приоритет, иначе expired_grace_days;
- lazeikaOnlySquadUuid имеет приоритет, иначе expired_grace_squad_uuid;
- при сохранении новых полей поддерживать запись legacy-ключей с теми же значениями до завершения миграции UI.

Новые ключи:

- lazeika_only_enabled;
- lazeika_only_days;
- lazeika_only_node_uuid;
- lazeika_only_squad_uuid;
- lazeika_only_speed_mbit;
- lazeika_only_profile_uuid;
- lazeika_only_resource_state;
- lazeika_only_message_template.

Значение lazeika_only_resource_state — JSON только с идентификаторами и служебным состоянием, без секретов:

~~~json
{
  "version": 1,
  "status": "UNCONFIGURED",
  "nodeUuid": null,
  "profileUuid": null,
  "baseProfileUuid": null,
  "managedInboundUuid": null,
  "managedInboundTag": null,
  "managedInboundPort": null,
  "squadUuid": null,
  "squadSource": "AUTO",
  "workingHostUuid": null,
  "notificationHostUuids": [],
  "previousNodeConfig": null,
  "createdResourceUuids": [],
  "ssh": {
    "interface": null,
    "rateMbit": 5
  },
  "lastError": null,
  "lastVerifiedAt": null,
  "updatedAt": null
}
~~~

previousNodeConfig нужен для восстановления только тех полей ноды, которые изменил setup. Приватный SSH-ключ и его содержимое в state запрещены.

### 5.3. Шаблон сообщения

Значение по умолчанию:

~~~text
🔐 Доступ к lazeika.xyz и Telegram

⏰ Ваша подписка закончилась!
✅ Доступ сохранён ещё на {count} дней!
💳 Продлите подписку, чтобы пользоваться всеми сервисами!
~~~

Поддерживаемый placeholder только один: {count}. Он заменяется на оставшееся число календарных дней, округлённое вверх, минимум 1 до окончания grace.

Валидация:

- текст не пустой;
- размер не больше 1000 символов;
- неизвестные placeholders запрещены;
- HTML/Markdown не интерпретировать как код;
- эмодзи разрешены.

## 6. API админ-панели

Добавить отдельный router для операций инфраструктуры:

### GET /admin/lazeika-only/status

Возвращает:

- нормализованные настройки;
- выбранную ноду и squad;
- состояние resource_state;
- список рабочих и notification-host;
- результат последней проверки;
- безопасное описание ошибки без секретов.

### POST /admin/lazeika-only/setup

Запускает идемпотентную настройку. Тело:

~~~json
{
  "nodeUuid": "uuid",
  "squadUuid": "uuid или null",
  "speedMbit": 5
}
~~~

Если squadUuid равен null, применяется автоматический поиск/создание.

Операция возвращает фазу ошибки/успеха и resource_state. При частичном сбое состояние ERROR должно содержать точную фазу и UUID уже созданных ресурсов.

### POST /admin/lazeika-only/verify

Проверяет без создания новых ресурсов:

- доступность Remnawave;
- существование профиля, inbound, squad и hosts;
- соответствие profile/inbound/node;
- отсутствие чужих inbounds в squad;
- доступность SSH;
- наличие tc;
- корректность filters;
- наличие рабочего systemd unit;
- сохранность SSH-соединения.

### POST /admin/lazeika-only/reconcile

Повторно приводит только управляемые ресурсы к сохранённому состоянию. Не должен создавать дубликаты и не должен перезаписывать ручные поля hosts.

### POST /admin/lazeika-only/disable

Выключает создание новых grace-доступов и запускает обычную обработку истечения. Уже активный grace отключается ближайшим maintenance-запуском. Инфраструктура не удаляется.

Все endpoints должны быть закрыты существующими requireAuth и requireAdminSection. UUID, числа и строки валидировать через Zod по текущему стилю проекта.

## 7. Алгоритм setup/reconcile

Операция должна быть идемпотентной и выполнять шаги в следующем порядке.

### 7.1. Валидация

Проверить:

- Remnawave настроен;
- nodeUuid существует и не отключена;
- у ноды есть address;
- SSH-конфигурация backend полная;
- выбранный squad существует либо может быть создан;
- текущий профиль ноды и его inbounds доступны;
- в проекте есть поддерживаемая Xray-схема для Telegram и BLOCK;
- на ноде можно определить свободный порт;
- ручной squad не содержит чужих inbounds.

До первого внешнего изменения сохранить исходные node/profile данные.

### 7.2. Профиль и inbound

1. Найти уже сохранённый managed profile по UUID.
2. Если он есть, проверить marker Lazeika-Only и обновить только управляемые элементы.
3. Если профиля нет, создать копию активного профиля ноды.
4. Добавить или найти inbound по стабильному marker.
5. Убедиться, что port свободен и не совпадает с SSH/Remnawave API/другим inbound.
6. Добавить только правила Lazeika-Only, не менять правила остальных inbound.
7. Создать/обновить config profile через существующий Remna client.
8. Применить профиль к ноде через существующий remnaUpdateNode, сохранив старые activeInbounds и добавив managed inbound.

Не создавать профиль при каждом запуске. Не использовать name как единственный идентификатор после первого создания.

### 7.3. Squad

1. Выбрать ручной UUID либо автоматически найти точное имя.
2. При отсутствии создать обычный internal squad.
3. В squad установить только managed inbound.
4. Проверить, что squad accessible nodes содержит только выбранную ноду.
5. Если API Remnawave не отдаёт это поле напрямую, проверить его через существующий endpoint accessible-nodes.

### 7.4. Hosts

1. Найти hosts из resource_state.
2. При отсутствии создать один рабочий host и три notification-host.
3. Рабочий host скопировать из существующего рабочего host выбранного профиля по техническим параметрам, но привязать к managed profile/inbound.
4. Notification-host создать с теми же техническими параметрами и isDisabled=true; адрес по умолчанию использовать из .invalid.
5. Добавить tag LAZEIKA_ONLY и роль в resource_state: WORKING или NOTIFICATION.
6. Не создавать дубликаты по повторному setup.
7. Редактирование notification-host выполнять существующим host editor; reconcile не должен затирать его пользовательские значения.

### 7.5. SSH/tc

1. Подключиться к node address по строгому known_hosts.
2. Передать на ноду validated interface, managed inbound port и speed.
3. Установить идемпотентный скрипт /usr/local/sbin/lazeika-only-tc.
4. Установить systemd unit, запускающий apply после network-online и после Docker/Xray.
5. Добавить filters только с собственным pref.
6. Проверить вывод tc, наличие портовых правил для ingress/egress и отсутствие изменений SSH.
7. Записать interface, rate и timestamp в resource_state.

Только после успешного прохождения всех шагов выставить status READY.

### 7.6. Компенсирующий rollback

При ошибке:

- не помечать инфраструктуру READY;
- восстановить node activeConfigProfileUuid и activeInbounds из snapshot, если они уже менялись;
- удалить только config profile/hosts/squad, созданные именно текущей операцией и записанные в createdResourceUuids;
- не удалять вручную выбранный squad;
- удалить только свои tc filters и systemd unit;
- не удалять общий root qdisc;
- оставить ERROR и человекочитаемую фазу ошибки.

Полного распределённого transaction между Remnawave и SSH нет, поэтому повторный reconcile должен уметь продолжить с сохранёнными UUID.

## 8. Изменения в backend

Переиспользовать существующие сервисы и клиенты:

- backend/src/modules/subscription/single-subscription-lifecycle.service.ts — состояние grace и восстановление;
- backend/src/modules/subscription/subscription-maintenance.cron.ts — существующий cron;
- backend/src/modules/client/client.service.ts — загрузка SystemSetting и cache invalidation;
- backend/src/modules/remna/remna.client.ts — nodes, config profiles, hosts, squads, users;
- backend/src/modules/tariff/tariff-activation.service.ts — восстановление после оплаты;
- backend/src/modules/sync/sync.service.ts и bulk sync — защита активного grace;
- backend/src/modules/admin/admin.routes.ts — настройки и admin routes.

Создать минимальный сервис, например backend/src/modules/lazeika-only/lazeika-only.service.ts, только если существующие lifecycle-сервисы не позволяют безопасно вынести setup/reconcile. Не добавлять отдельные фабрики, репозитории и абстракции с одной реализацией.

Обязательные backend-изменения:

1. Устранить повторный пересчёт graceUntil при каждом cron.
2. Не записывать graceUntil до успешного Remnawave update.
3. Исключать managed Lazeika-Only squad из mergeSquads при оплате.
4. Добавить guard во все пути sync/update, которые могут перезаписать active grace.
5. Добавить загрузку/валидацию новых настроек.
6. Добавить ресурсный setup/reconcile с marker-ами.
7. Добавить SSH executor через системный ssh без новой зависимости, если в package.json уже нет безопасного SSH-клиента.
8. Не переиспользовать backend/src/modules/server/server.service.ts для удалённого SSH: этот сервис управляет локальным sshd панели и имеет другую ответственность.

## 9. Изменения в frontend

Переиспользовать существующий раздел Settings и существующий Remnawave hosts page.

В settings.tsx добавить отдельную карточку «Lazeika-Only — режим продления»:

- toggle;
- количество дней, значение 7;
- скорость, значение 5;
- выбор ноды;
- выбор squad или автоматический режим;
- текстовое поле уведомления с preview;
- статус setup;
- последняя ошибка;
- кнопки setup/verify/reconcile;
- ссылка на редактор hosts.

В frontend/src/lib/api.ts добавить типы и методы для settings/status/setup/verify/reconcile.

В существующую модель кабинета добавить признак:

~~~ts
lazeikaOnly?: {
  active: boolean;
  daysLeft: number;
  message: string;
};
~~~

Во время grace показывать пользователю:

~~~text
🔐 Доступ к lazeika.xyz и Telegram

⏰ Ваша подписка закончилась!
✅ Доступ сохранён ещё на {count} дней!
💳 Продлите подписку, чтобы пользоваться всеми сервисами!
~~~

Для raw Remnawave subscription URL не создавать отдельную копию host на каждого пользователя. Персональный count показывать в кабинете и Telegram, где есть локальная информация о subscription/graceUntil.

## 10. Безопасность

- Все admin endpoints требуют текущую admin-аутентификацию.
- Не принимать произвольные shell-команды из frontend.
- Не принимать произвольный удалённый host вне списка Remnawave nodes.
- Не хранить приватный SSH-ключ в БД, логах или API response.
- Логировать только node UUID, фазу, exit code и безопасный текст ошибки.
- Скрывать ключи, токены и команды с секретами из UI.
- Использовать strict known_hosts.
- Ограничить диапазон speed и дней.
- Проверять UUID и имя marker.
- Запрещать правила tc, затрагивающие SSH-порт.
- Перед установкой фильтров проверить, что managed inbound port не равен SSH-порту.
- При неизвестной сетевой топологии прекращать setup, а не применять глобальный limiter.
- Применять Xray routing только по точному inboundTag.
- Не изменять чужие squad/profile/hosts без явного UUID из resource_state.

## 11. Тестирование

### 11.1. Unit-тесты

Покрыть:

- чтение новых настроек и legacy fallback;
- валидацию дней, скорости, UUID и template;
- fixed graceUntil;
- выключенную функцию;
- отсутствие READY-инфраструктуры;
- вход в grace только после успешного Remna update;
- окончание grace;
- фильтрацию Lazeika-Only squad из mergeSquads;
- пропуск обычного sync во время grace;
- построение Xray allow/block rules;
- уникальность inbound tag и port;
- идемпотентность resource_state;
- построение tc-команд без SSH/root-qdisc изменений;
- запрет опасных значений interface, port и shell args.

### 11.2. Integration-тесты

С fake Remna client и fake SSH executor проверить:

- setup с чистого состояния;
- повторный setup без дубликатов;
- ручной squad с чужим inbound — setup отклонён;
- автоматическое создание squad только один раз;
- rollback после сбоя Remna profile;
- rollback после сбоя SSH;
- восстановление после удаления host/profile;
- изменение node с сохранением старого state;
- reconfigure не меняет чужие hosts;
- повторная проверка READY.

### 11.3. Приёмочные сценарии

1. Администратор включает функцию, задаёт 7 дней, выбирает ноду и нажимает «Настроить».
2. В Remnawave появляется один обычный squad Lazeika-Only.
3. Появляется отдельный config profile с managed inbound.
4. Профиль применён к выбранной ноде, а hosts ссылаются на этот профиль и inbound.
5. В squad доступен только выбранный inbound/нода.
6. У истёкшего пользователя в течение одного cron-цикла:
   - статус ACTIVE;
   - expireAt равен graceUntil;
   - squad только Lazeika-Only;
   - доступны Telegram и lazeika.xyz;
   - остальные домены заблокированы;
   - скорость не превышает 5 Mbit/s суммарно на managed inbound;
   - SSH и служебный API продолжают работать без ограничения.
7. В подписке видны рабочий host и три notification-host с текстом продления.
8. В кабинете и Telegram отображается корректный динамический count.
9. Через graceUntil пользователь получает DISABLED.
10. При оплате во время grace восстанавливаются тарифные squad, скорость/трафик, HWID и новый срок.
11. Повторная настройка не создаёт второй profile, squad, inbound или hosts.
12. После перезагрузки ноды tc-ограничение поднимается снова.
13. Выключение функции не выдаёт новые grace-доступы и не удаляет инфраструктуру.

## 12. Документация для deployment

В deployment-документации добавить:

- обязательные SSH env;
- пример монтирования private key и known_hosts в backend;
- требования к root/capabilities для tc;
- требования к systemd и tc на ноде;
- ограничение MVP: 5 Mbit/s является агрегированным лимитом inbound;
- порядок безопасного удаления только после явного решения администратора.

Полезные внешние ограничения, которые нужно учитывать при реализации:

- в Remnawave squad выбирает inbounds, а доступные ноды выводятся из этих inbounds: https://docs.rw/learn-en/squads/;
- срок действия и internal squads являются параметрами Remnawave пользователя: https://docs.rw/learn-en/users/;
- Xray не предоставляет готовый универсальный per-client bandwidth limiter, поэтому ограничение выполняется на node-level через tc: https://github.com/XTLS/Xray-core/discussions/2510.

## 13. Definition of Done

Функция считается готовой, если:

- реализована в отдельной ветке codex/;
- существующие dirty-файлы пользователя не перезаписаны;
- нет новой локальной технической подписки и новой Prisma-модели без необходимости;
- squad обычный, создаётся максимум один раз и может быть выбран вручную;
- config profile создаётся отдельно, применяется к выбранной ноде и hosts;
- profile/inbound/squad/hosts setup идемпотентен;
- Lazeika-Only доступ ограничен Telegram + lazeika.xyz;
- tc ограничивает только Xray Lazeika-Only port и не затрагивает SSH;
- срок доступа редактируется в админ-панели и применяется к новым grace-сессиям;
- динамическое сообщение с count отображается в локальном кабинете и Telegram;
- обычные sync и renewal не ломают grace;
- оплата корректно возвращает пользователя к тарифу;
- выполнены unit, integration и приёмочные проверки;
- в логах нет секретов и произвольных shell-команд.

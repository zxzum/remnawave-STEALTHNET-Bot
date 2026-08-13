# Лазейка ВПН — кабинет, бот и ручная конвертация

**Дата:** 2026-08-13  
**База реализации:** `4b6e759`

## Цель

Дать клиенту Лазейки ВПН возможность вручную перевести существующую подписку
на другой тариф без покупки дополнительного месяца, предварительно показать
точный пересчёт остатка и безопасно применить его без смены Remnawave UUID и
ссылки подписки.

## Архитектура

Новый `backend/src/modules/client/subscription-conversion.routes.ts` будет
отдельным авторизованным роутером, смонтированным под `/api/client`.
Он предоставляет:

- `POST /subscription-conversion/quote` — проверяет подписку и тариф, считает
  quote и возвращает подписанный токен;
- `POST /subscription-conversion` — проверяет токен и применяет его.

Quote подписывается существующим `env.JWT_SECRET` как JWT с TTL 15 минут.
Payload содержит `clientId`, `subscriptionId`, `tariffId`, `priceOptionId`,
`sourceExpireAt`, `sourceRevision` (`Subscription.updatedAt`), направление,
комиссию и `convertedDays`. Токен не является правом доступа: при применении
сервер повторно проверяет владельца, тариф, опцию, срок, revision и UUID.

Применение выполняется под `withClientSubscriptionLock`. Remnawave получает
PATCH с тем же UUID; reissue/revoke не вызывается. После успешного PATCH
обновляются `Subscription` и совместимые legacy-поля primary-подписки. Схема
БД не меняется и owner-only `UNIQUE` не добавляется.

## Политика пересчёта

Используется существующая чистая функция `quoteConvertedDays`:

- same tariff и trial: остаток переносится 1:1, комиссия 0%;
- upgrade: `raw = remainingDays × oldPricePerDay / newPricePerDay`,
  применение разрешено только при `raw >= 1`, результат `ceil(raw)`;
- downgrade: результат `floor(raw × 0.95)`, комиссия 5%;
- equal: без комиссии, целые дни по существующей policy.

Остаток — целые дни `floor` от исходного `expireAt`. Ставка текущей
подписки учитывает сохранённые дополнительные устройства; целевая ставка
берётся из выбранного тарифа/price option и тех же устройств. Это сохраняет
математику существующего backend preview.

Stale quote возвращает `409`, если истёк TTL либо изменились subscription,
`expireAt`, `updatedAt`, target tariff или price option. Невозможный upgrade с
raw меньше одного дня не получает применяемый quote.

## Клиентские поверхности

`frontend/src/lib/api.ts` получает минимальные wrappers quote/apply и reissue.
`Tariffs.tsx` показывает кнопку «Конвертация», текущий и целевой тариф,
остаток, правило округления, комиссию и итоговые дни. После upgrade показывает
«Оплатить ещё месяц». В обычной покупке отображаются дни, добавляемые
конвертацией.

`Keys.tsx` получает confirmation перед reissue. Текст явно сообщает, что
старая ссылка и конфигурации перестанут работать, и рекомендует обычный сайт,
а не mini-app.

Бот получает только backend preview/quote через `bot/src/api.ts`; формулы в
`bot/src/index.ts` не дублируются. В keyboard/confirmation сохраняется явное
предупреждение о неработающей старой ссылке и конфигурациях.

## Тестирование

Сначала RED-тест в
`backend/src/modules/client/manual-conversion.test.ts` проверяет rounding,
commission, same/trial, stale token и сохранение UUID/link. Затем добавляется
минимальная реализация. Финальная проверка:

```bash
cd backend
rtk npx tsx --test src/modules/client/manual-conversion.test.ts
rtk npx tsc --noEmit --pretty false
cd ../frontend
rtk npm run build
cd ../bot
rtk npm test
rtk npm run build
```

## Неизменные ограничения

- Существующий `remnawaveUuid`, short UUID и ссылка пользователя не меняются.
- Ссылка меняется только ручным reissue.
- `multiSubscriptionsEnabled=false` не создаёт вторую подписку; `true` не
  запрещает существующие дополнительные подписки.
- Production cleanup с `--apply` не выполняется.
- Все shell-команды запускаются через `rtk`.

# Roadmap: обычная Remnawave-подписка и локальный учет трафика squad

**Design:** [`../specs/2026-07-18-single-subscription-squad-traffic-design.md`](../specs/2026-07-18-single-subscription-squad-traffic-design.md)

## Порядок выполнения

Планы выполняются строго последовательно. Каждый этап оставляет production в рабочем и отдельно проверяемом состоянии.

| Этап | Документ | Результат |
| --- | --- | --- |
| 1 | [`2026-07-18-01-remove-composite-runtime.md`](2026-07-18-01-remove-composite-runtime.md) | Runtime больше не создает и не обслуживает composite components; одна STEALTHNET subscription работает через одного Remnawave user. Legacy-таблицы временно остаются только для финальной миграции. |
| 2 | [`2026-07-18-02-squad-quota-model-admin.md`](2026-07-18-02-squad-quota-model-admin.md) | Тарифы и Trial поддерживают взаимоисключающие режимы `REMNAWAVE`/`LOCAL_SQUAD`, персональные периоды, дополнительные гигабайты и полную админ-интеграцию. |
| 3 | [`2026-07-18-03-squad-traffic-worker.md`](2026-07-18-03-squad-traffic-worker.md) | Bulk API-брокер Remnawave учитывает только ноды выбранного squad, отправляет пороги и отзывает только этот squad при исчерпании. |
| 4 | [`2026-07-18-04-conversion-migration-cutover.md`](2026-07-18-04-conversion-migration-cutover.md) | Конвертация и продления подключены к локальным периодам; текущие клиенты переведены на обычных Remnawave users; composite schema/code удалены окончательно. |

## Общие стоп-условия

Нельзя переходить к следующему этапу, если:

- backend tests или frontend build не проходят;
- существует runtime-путь, создающий второй Remnawave user для одной `Subscription`;
- обычная Remnawave subscription или стабильная ссылка `/api/sub/:publicSubscriptionToken` не работает;
- dry-run миграции показывает подписку без однозначных `createdAt`, `expireAt`, тарифа или набора squad;
- статистика Remnawave неполная либо выборка `topUsers` упирается в `topUsersLimit`;
- EU/Default трафик изменяет локальный счетчик Whitelist.

## Production-последовательность

```text
backup
  -> этап 1: single-user runtime
  -> этап 2: schema + admin, enforcement выключен
  -> этап 3: observe-only accounting
  -> сверка EU/WL
  -> этап 4: миграция тестового клиента
  -> миграция остальных клиентов
  -> подтверждение обновления subscription
  -> удаление старых component users
  -> контроль EU/WL и включение enforcement
  -> drop composite schema
```

## Итоговые обязательные проверки

- Тариф `Default + Whitelist`, `meteredSquadUuid=Whitelist`: EU не списывается, WL списывается.
- Исчерпание удаляет только Whitelist, Default продолжает работать.
- Персональный reset идет от даты покупки.
- Trial имеет собственный лимит.
- `CURRENT_PERIOD` сгорает на reset; `WHILE_TARIFF_ACTIVE` переживает продление того же тарифа и удаляется при смене.
- Upgrade/downgrade сохраняет текущую pro-rata формулу дней.
- У каждого текущего клиента после cutover один обычный Remnawave user с правильными `createdAt` и `expireAt`.
- Старый whitelist usage не переносится; новый локальный учет начинается с `0`.

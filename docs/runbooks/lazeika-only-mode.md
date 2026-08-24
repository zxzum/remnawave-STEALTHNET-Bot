# Runbook: Lazeika-Only — режим продления

Режим выдаёт истёкшим подпискам ограниченный доступ (Telegram + lazeika.xyz и все поддомены,
Mini App; весь остальной трафик блокируется) на настраиваемый срок. Лимит — агрегированный
5 Mbit/s (по умолчанию) на весь managed-inbound ноды. Спецификация:
`docs/superpowers/specs/2026-08-22-lazeika-only-design.md`.

## SSH-доступ

Пароль/порт/user вводятся администратором в UI при каждой операции «Настроить / Проверить /
Перенастроить» (SSH-modal). Host всегда берётся из `address` выбранной Remnawave-ноды. Пароль:
- живёт только в памяти запроса;
- НЕ сохраняется в Prisma/SystemSetting/resource_state;
- не возвращается API, не пишется в логи/ошибки/argv/env.

Транспорт — npm-пакет `ssh2` (password auth, private-key flow не используется). Строгая
проверка host key по файлу `LAZEIKA_ONLY_SSH_KNOWN_HOSTS` (plain и hashed `|1|` форматы;
для нестандартного порта проверяется и форма `[host]:port`). Отсутствие записи или mismatch —
отказ с подсказкой:

```bash
ssh-keyscan -p <порт> <адрес-ноды> >> /path/to/known_hosts
```

Пример монтирования known_hosts в docker-compose (сервис api):

```yaml
environment:
  LAZEIKA_ONLY_SSH_KNOWN_HOSTS: /run/secrets/lazeika_known_hosts
secrets:
  - lazeika_known_hosts
```

## Требования к ноде

- root или `CAP_NET_ADMIN` для tc;
- `tc` (iproute2) и `systemd`;
- порт управляемого inbound должен быть виден на хосте (прямой listen либо docker-published). Иначе setup завершится ошибкой «топология ноды не поддерживается автоматически»;
- порт managed-inbound обязан быть **уникален** в активном конфиге ноды и не совпадать с SSH-портом: tc-лимит работает по порту, общий порт с другим inbound ограничил бы чужой трафик. Setup отклоняет такую конфигурацию до любых мутаций.

## Модель инфраструктуры (IN_PLACE)

- Режим профиля — **только IN_PLACE**: активный профиль ноды расширяется двумя inbound'ами
  (managed + notification), второй активный профиль на ноде не создаётся, нода не переключается
  на копию. Поддержки CLONE нет; сохранённое CLONE-состояние с managed-ресурсами отклоняется
  с подсказкой вызвать `POST /admin/lazeika-only/reset-state`.
- Squad: обычный видимый internal squad `Lazeika-Only` (создаётся один раз) либо выбранный
  вручную (обязан быть пустым или уже управляться режимом). Squad содержит ровно managed +
  notification inbound и доступен ровно на выбранной ноде.
- Hosts пользователя: один рабочий host (binding на managed-inbound) и три fake
  notification-host'а. Владение fake-host'ами детерминировано: в `resource_state` хранятся
  ровно три `notificationHostUuids`; reconcile использует только их, чужие host'ы с тем же
  тегом не захватываются и не изменяются, список перезаписывается целиком (не append).
- Fake-hosts: адреса `.invalid`, видимые (isDisabled=false), remark — из настроек панели
  (`lazeika_only_notification_message_1..3`, лимит 200 символов). **Панель — источник истины
  для remark**: при reconcile remark каждого из трёх управляемых host'ов приводится к текущему
  сообщению (включая случай null/undefined в Remnawave); ручные правки remark в Remnawave
  будут перезаписаны.
- Ограничение контракта Remnawave: host без inbound-связи в подписку не попадает, поэтому
  fake-hosts привязаны к **техническому notification-inbound** в том же managed-профиле
  (отдельный уникальный порт, routing `inboundTag → BLOCK` на весь tcp,udp). Это
  BLOCK-связь, а не рабочий профиль: подключиться через fake-hosts нельзя. Порт
  notification-inbound выбирается один раз и далее не меняется; порт каждого fake-host'а
  равен ему (проверяется verify).

## Ограничения MVP

- Скорость — **агрегированный** лимит на весь Lazeika-Only inbound ноды (по умолчанию 5 Mbit/s), не на пользователя.
- Реализация: 8 flower-классификаторов (IPv4/IPv6 × TCP/UDP × ingress/egress) ссылаются на **общие police actions**
  (index 45101 ingress / 45102 egress) — один token bucket на направление. Лимит НЕ складывается из восьми независимых.
- tc-фильтры занимают ровно pref **11000–11007**; root qdisc и firewall не изменяются; чужие
  qdisc/filter/action не удаляются.
- Миграция с v1 (legacy pref 11001–11008): установочный скрипт сам снимает старые префы перед установкой новых.
- После перезагрузки ноды лимит восстанавливает `lazeika-only-tc.service` (unit содержит set -euo pipefail
  и самопроверку всех pref'ов и police actions).

## Rollback и reset-state

- Каждая внешняя мутация (Remnawave и SSH/tc/systemd), включая компенсационные операции
  rollback, выполняется только после проверки lease (lockToken в `resource_state`). Потеря
  lease ⇒ немедленная остановка без дальнейших компенсаций — ресурсы нового владельца не
  трогаются.
- Rollback восстанавливает: активный профиль/инбаунды ноды (`previousNodeConfig`), свой срез
  конфига профиля (managed+notification inbound'ы и их routing-правила — чужие правки в
  конфиге сохраняются), inbounds squad, все изменяемые поля host'ов (binding, tags, port,
  remark, isDisabled, connection/security-параметры), прежний tc-лимитер (или полный cleanup
  только своих pref/action/unit, если лимитера не было).
- `POST /admin/lazeika-only/reset-state` — безопасный сброс `resource_state` (только при
  выключенном режиме). Обязателен перед сменой ноды и при наследии CLONE-состояния.
  Инфраструктуру в Remnawave не трогает.

## Безопасное удаление инфраструктуры

Автоудаления нет (защита пользователей). Ручной порядок:

1. Выключить режим в админке («Выключить режим») — новые grace-доступы прекращаются.
2. Убедиться, что активных grace-подписок нет (`subscriptions.graceUntil is null`).
3. Удалить вручную: из активного config-профиля ноды inbound'ы `LAZEIKA_ONLY_INBOUND_*` и их
   routing-правила, squad `Lazeika-Only`, hosts с тегом `LAZEIKA_ONLY`, вернуть ноде исходные
   activeInbounds (`resource_state.previousNodeConfig`).
4. На ноде: `systemctl disable --now lazeika-only-tc.service`, удалить `/etc/systemd/system/lazeika-only-tc.service`, `/usr/local/sbin/lazeika-only-tc`, фильтры `tc filter del dev <iface> ingress|egress pref 11000..11007`, общие actions `tc action del action police index 45101|45102`.

## Что проверяется только на живом staging

Unit/contract-тесты покрывают логику на fake-окружении. На реальной связке Remnawave + VPS
остаётся проверить вручную:

- setup → подписка HAPP/Incy показывает 1 рабочий + 3 fake-host'а; через fake-hosts
  подключение невозможно;
- фактический шейпинг: агрегированная скорость ≤ лимита на managed-inbound, SSH и соседние
  inbound'ы не затронуты (замер iperf/скорости Telegram);
- docker-published порт (docker-proxy) корректно детектируется;
- hashed known_hosts (`|1|`) против реального `ssh-keyscan -H`;
- перезагрузка ноды: `lazeika-only-tc.service` восстанавливает фильтры;
- verify на живой ноде: все проверки (включая `managed_port_unique`, `notification_host_port`,
  `tc_filters`, `tc_rate_aggregate`) зелёные.

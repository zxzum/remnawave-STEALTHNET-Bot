# Runbook: Lazeika-Only — режим продления

Режим выдаёт истёкшим подпискам ограниченный доступ (Telegram + lazeika.xyz, 5 Mbit/s) на настраиваемый срок. Спецификация: `docs/superpowers/specs/2026-08-22-lazeika-only-design.md`.

## SSH-доступ

Пароль/порт/user вводятся администратором в UI при каждой операции «Настроить / Проверить /
Перенастроить» (SSH-modal). Пароль:
- живёт только в памяти запроса;
- НЕ сохраняется в Prisma/SystemSetting/resource_state;
- не возвращается API и не пишется в логи.

Транспорт — npm-пакет `ssh2` (password auth). Строгая проверка host key по файлу
`LAZEIKA_ONLY_SSH_KNOWN_HOSTS` (plain и hashed |1| форматы); отсутствие записи или mismatch —
отказ с подсказкой выполнить `ssh-keyscan`. |

Пример монтирования в docker-compose (сервис api):

```yaml
environment:
  LAZEIKA_ONLY_SSH_PRIVATE_KEY_PATH: /run/secrets/lazeika_only_ssh_key
  LAZEIKA_ONLY_SSH_KNOWN_HOSTS: /run/secrets/lazeika_known_hosts
secrets:
  - lazeika_only_ssh_key
  - lazeika_known_hosts
```

Приватный ключ никогда не хранится в БД/SystemSetting/логах — только в env/secrets.

## Требования к ноде

- root или `CAP_NET_ADMIN` для tc;
- `tc` (iproute2) и `systemd`;
- порт управляемого inbound должен быть виден на хосте (прямой listen либо docker-published). Иначе setup завершится ошибкой «топология ноды не поддерживается автоматически».

## Ограничения MVP

- Скорость — **агрегированный** лимит на весь Lazeika-Only inbound ноды (по умолчанию 5 Mbit/s), не на пользователя.
- Реализация: 8 flower-классификаторов (IPv4/IPv6 × TCP/UDP × ingress/egress) ссылаются на **общие police actions**
  (index 45101 ingress / 45102 egress) — один token bucket на направление. Лимит НЕ складывается из восьми независимых.
- Профиль: режим **IN_PLACE** (по умолчанию) расширяет активный профиль ноды managed+notification inbound'ами,
  не переключая ноду на clone; CLONE остаётся fallback. Rollback IN_PLACE хирургический: удаляются только наши
  inbound/rules, чужие изменения сохраняются.
- Notification-hosts: ровно 3 видимые записи (isDisabled=false), адреса `.invalid`, привязаны к notification-inbound'у
  managed-профиля; весь его трафик блокируется правилом BLOCK по тегу inbound'а. Ограничение Remnawave: host без
  inbound в подписку не попадает — поэтому техническая связь обязательна, но подключение невозможно.
- Сообщения fake-hosts: ключи `lazeika_only_notification_message_1..3`, имя профиля уведомлений —
  `lazeika_only_notification_profile_name`. Редактируются в карточке Lazeika-Only (лимит 200 символов).
- tc-фильтры занимают ровно pref **11000–11007**; root qdisc и firewall не изменяются.
- Миграция с v1 (legacy pref 11001–11008): установочный скрипт сам снимает старые префы перед установкой новых.
- После перезагрузки ноды лимит восстанавливает `lazeika-only-tc.service` (unit содержит set -euo pipefail
  и самопроверку всех pref'ов и police actions).

## Безопасное удаление инфраструктуры

Автоудаления нет (защита пользователей). Ручной порядок:

1. Выключить режим в админке («Выключить режим») — новые grace-доступы прекращаются.
2. Убедиться, что активных grace-подписок нет (`subscriptions.graceUntil is null`).
3. Удалить вручную: config profile `Lazeika-Only — <нода>`, squad `Lazeika-Only`, hosts с тегом `LAZEIKA_ONLY`, вернуть ноде исходный профиль (`resource_state.previousNodeConfig`).
4. На ноде: `systemctl disable --now lazeika-only-tc.service`, удалить `/etc/systemd/system/lazeika-only-tc.service`, `/usr/local/sbin/lazeika-only-tc`, фильтры `tc filter del dev <iface> ingress|egress pref 11000..11007`, общие actions `tc action del action police index 45101|45102`.

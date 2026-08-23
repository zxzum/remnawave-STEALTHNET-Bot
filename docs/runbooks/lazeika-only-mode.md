# Runbook: Lazeika-Only — режим продления

Режим выдаёт истёкшим подпискам ограниченный доступ (Telegram + lazeika.xyz, 5 Mbit/s) на настраиваемый срок. Спецификация: `docs/superpowers/specs/2026-08-22-lazeika-only-design.md`.

## Обязательные env (backend)

| Переменная | Значение |
|---|---|
| `LAZEIKA_ONLY_SSH_PRIVATE_KEY_PATH` | Путь к приватному ключу внутри контейнера backend |
| `LAZEIKA_ONLY_SSH_KNOWN_HOSTS` | Путь к файлу known_hosts (обязателен, strict checking) |
| `LAZEIKA_ONLY_SSH_USER` | SSH-пользователь ноды (по умолчанию `root`) |
| `LAZEIKA_ONLY_SSH_PORT` | SSH-порт ноды (по умолчанию `22`) |

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

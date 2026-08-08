# Telegram Auto-Created Notification Topics

## Goal

When an administrator configures a Telegram notification group, Лазейка ВПН automatically creates and remembers named forum topics for every admin-notification category. Existing manually configured topic IDs remain valid and are not overwritten.

## Scope

The feature covers the main notification group and the optional managers group:

- Main group: new clients, payments, tickets, automatic backups, trial activations, subscription conversions, withdrawal requests, promo codes, redeemed gifts, failed auto-renewals, and revoked subscriptions.
- Managers group: ticket notifications in a dedicated “🎫 Тикеты менеджеров” topic.

The existing system-setting storage is reused. No database migration or new dependency is required.

## Topic names

The main group topics use these stable names:

| Setting key | Topic name |
| --- | --- |
| `notification_topic_new_clients` | `👤 Новые клиенты` |
| `notification_topic_payments` | `💳 Платежи` |
| `notification_topic_tickets` | `🎫 Тикеты` |
| `notification_topic_backups` | `💾 Авто-бэкапы` |
| `notification_topic_trials` | `🎁 Пробный период` |
| `notification_topic_conversions` | `🔄 Конвертации` |
| `notification_topic_withdrawals` | `💸 Заявки на вывод` |
| `notification_topic_promo` | `🏷 Промокоды` |
| `notification_topic_gifts` | `🎟 Подарки` |
| `notification_topic_auto_renew` | `⚠️ Сбои автосписания` |
| `notification_topic_subscription_revoked` | `⛔ Аннулирование подписок` |

The managers topic uses `notification_managers_topic_tickets` and the name `🎫 Тикеты менеджеров`.

## Behavior

The admin settings save flow calls an idempotent backend helper after the group IDs are persisted:

1. If a group ID is empty, no topics are created.
2. If a topic setting already contains an ID, it is preserved.
3. If a topic setting is empty, the helper calls Telegram Bot API `createForumTopic` with the configured name and stores the returned `message_thread_id`.
4. If the configured group ID changes, topic IDs belonging to the old group are cleared before creating topics for the new group.
5. If Telegram rejects topic creation (the chat is not a forum supergroup, the bot is not an administrator, or it lacks topic-management rights), the settings save returns a clear error and does not silently claim that setup completed.
6. Existing notification sending continues to use `message_thread_id`; auto-backup keeps using the same topic storage and `sendDocument` path.

The helper is safe to call repeatedly: it only creates topics for empty settings. No topic-list lookup or background scheduler is added.

## Missing notification category

`subscription_revoked` is added to the topic configuration path. Both successful revocation notices and revocation-sync failures use the new “⛔ Аннулирование подписок” topic instead of falling back to the group’s General topic.

## UI

The current category fields remain available for compatibility and inspection of the stored IDs. Their labels continue to describe the categories; the helper fills the IDs automatically. The missing subscription-revocation field is added alongside the other main-group topics. The existing managers-topic field remains conditional on a managers group ID.

## Verification

- Unit tests cover the topic-name mapping, preservation of existing IDs, creation of missing topics, group-change reset, and Telegram error propagation.
- A focused backend test command is run first, followed by the full backend test suite and TypeScript build.

# Client And Tariff Consistency Design

## Goal

Keep account creation lightweight until a trial or tariff is activated, while making empty accounts, multi-subscription activity, tariff entitlements, and onboarding controls display correctly.

## Decisions

- Registration creates only `Client`. It does not create a placeholder Remnawave user or subscription.
- Admin client tabs are always visible. Subscription-dependent tabs render an empty state until a subscription exists.
- Client labels use Telegram username, then email, then `tg<telegramId>`, then client ID. `@null` is never rendered.
- The admin client list is enriched from `subscriptions`, not the legacy `Client.remnawaveUuid`: it exposes subscription summaries and supports `all`, `with subscription`, and `with active subscription` filters.
- Activity is the newest `onlineAt` across every Remnawave UUID owned by the client, including the legacy UUID only as a compatibility fallback.
- Tariff cards use `includedDevices` for the included device count.
- `LOCAL_SQUAD` tariffs show general VPN traffic as unlimited and show the metered whitelist quota separately. `REMNAWAVE` tariffs keep their single traffic limit display.
- Updating a `LOCAL_SQUAD` tariff's traffic limit updates matching quota `baseLimitBytes` transactionally while preserving `usedBytes`, grants, and period boundaries.
- The 2FA onboarding step gets one global boolean setting. Disabling it removes the step from registration onboarding; users can still enable 2FA later in profile settings.

## Production Reconciliation

After backup and deployment, update only quota `baseLimitBytes` values that reference a `LOCAL_SQUAD` tariff and differ from that tariff. Do not change usage, grants, status, or period timestamps. Verify mismatches are zero afterward.

## Verification

- Backend contract/unit tests cover filtering, subscription aggregation, preserved quota usage, and the onboarding setting.
- Frontend tests or extracted pure-helper tests cover labels, device count, and traffic badges.
- Backend and frontend builds pass.
- Browser QA checks the clients list/modal and `/cabinet/tariffs` on desktop and mobile.

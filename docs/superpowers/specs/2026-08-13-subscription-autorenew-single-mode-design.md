# Subscription Auto-Renewal Ownership Design

**Goal:** Make canonical `Subscription` rows the source of truth for automatic renewal without changing existing Remnawave identities or subscription links.

## Decisions

- If `Subscription[0]` exists for a client, the legacy `Client` auto-renewal loop never renews that client, regardless of `Client.autoRenewEnabled` or `Subscription[0].autoRenewEnabled`.
- The legacy `Client` loop remains only as a compatibility fallback for old clients that have no canonical primary `Subscription[0]`.
- When `multiSubscriptionsEnabled=false`, only `Subscription[0]` may be auto-renewed. Individual secondary subscriptions are ignored by the auto-renew scheduler.
- When `multiSubscriptionsEnabled=true`, every eligible individual `Subscription` with `autoRenewEnabled=true` may be renewed, including index `0`.
- Each eligible subscription gets at most one charge path per cron pass: one balance/card decision, one `Payment`, and one activation call.
- An individual `Subscription.autoRenewEnabled=false` always disables renewal for that subscription; the client-level legacy flag cannot override it when a canonical row exists.
- Existing `remnawaveUuid`, short UUID, and user subscription URL are not modified. URL changes remain limited to explicit manual reissue flows.
- No owner-only database uniqueness constraint is added.

## Runtime flow

1. Load `multiSubscriptionsEnabled` with the other system settings.
2. Load canonical subscriptions with `autoRenewEnabled=true`, excluding deletion tombstones and blocked owners.
3. In single mode, retain only `subscriptionIndex=0`.
4. Process each canonical subscription using the existing balance-first/card-fallback payment behavior.
5. Skip the legacy client loop for every client that has a canonical `Subscription[0]`, including when that row is manually disabled.
6. Process the legacy client loop only for clients without a canonical primary row.

The existing retry behavior remains idempotent: a recent paid YooKassa payment is used for activation retry without another charge; balance debits are restored when activation fails; a failed balance payment is marked `FAILED`.

## Error handling

- Balance debit and payment creation remain separate from external activation so activation can observe the committed payment.
- Activation failure restores any balance debit and marks a balance payment failed.
- YooKassa payments remain paid for activation retry, so the next cron pass does not charge the card twice.
- Notification failures remain best-effort and do not turn a successful renewal into a second charge.

## Tests

`backend/src/modules/payment/auto-renew-single-mode.test.ts` will exercise the cron source through a focused executable contract harness. It will cover:

- legacy `Client` plus canonical `Subscription[0]` produces one payment and one activation;
- canonical per-subscription auto-renew flags are respected;
- single mode processes only the primary subscription;
- multi mode keeps multiple individual subscriptions eligible;
- retry does not double days or money;
- activation failure compensates balance and marks the balance payment failed;
- no identity or subscription URL fields are changed by the renewal flow.

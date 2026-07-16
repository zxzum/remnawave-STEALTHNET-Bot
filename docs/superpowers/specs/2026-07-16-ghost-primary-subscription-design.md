# Ghost Primary Subscription Fix

## Problem

After logical subscription index `0` is revoked, its `Subscription` row is removed but `Client.remnawaveUuid` can still reference the former Remnawave user. `GET /api/client/subscription` falls back to that legacy UUID, so STEALTHNET reports no subscriptions in `/subscription/all` while still exposing the upstream `sub.lazeika.xyz` URL.

## Design

- `GET /api/client/subscription` must use only the persisted primary `Subscription` row. Without index `0`, it returns `subscription: null`; `Client.remnawaveUuid` is not a subscription source.
- A successful revoke or delete of primary index `0` clears its legacy UUID, tariff, price, and auto-renew state in the shared lifecycle service.
- Existing public-link replacement remains the only client-visible URL path, producing `bot.lazeika.xyz/api/sub/<token>` from the configured public application URL.
- Production cleanup deletes the orphan Remnawave user for `@sallyqx`, then clears the two legacy client fields and verifies that both STEALTHNET and Remnawave no longer contain the subscription.

## Verification

- A regression contract test rejects the legacy fallback and requires primary lifecycle cleanup.
- Run the focused test, the complete backend test suite, and the TypeScript build.
- Read back the production client, subscriptions, components, and Remnawave UUID after cleanup.

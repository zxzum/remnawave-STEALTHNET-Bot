# Trial purchase lock implementation plan

## Goal

Make any paid VPN purchase permanently consume the client's trial entitlement, remove conflicting standalone trial subscriptions through the existing Remnawave deletion lifecycle, and show a clear expired-trial state in the new cabinet.

## Scope and invariants

- A successful payment for an ordinary tariff or `customBuild` is a paid VPN purchase. Top-ups, extra options, proxy slots, sing-box slots, and admin grants do not set `Client.trialUsed`.
- The flag is set idempotently before paid tariff activation. It is never cleared by paid-purchase cleanup.
- Trial cleanup only targets non-gift subscriptions with `trialId != null`; every deletion goes through `deleteSingleSubscription`, so failed Remnawave calls remain in the existing retry queue.
- Both legacy and table-driven trial endpoints re-check the paid/trial lock on the server. No new recurring scan or cron is added.
- Historical repair is a manual batched command with `dry-run` by default and explicit `--apply`; dry-run performs no writes and no Remnawave calls.
- Only `frontend/src/cabinet/pages/Cabinet.tsx` is changed for the new cabinet; legacy cabinet pages remain untouched.

## Tasks

1. Add the smallest shared backend service for payment classification, paid-subscription detection, idempotent flagging, and sequential trial cleanup through the existing lifecycle. Add focused tests for classification, blocking, and retry-safe cleanup behavior.
2. Call the lock from the paid tariff payment/activation path, replace one-trial cleanup with all-separate-trials cleanup, and preserve the explicit trial being converted when necessary. Keep duplicate payment handling idempotent.
3. Add fresh server-side lock checks to both trial APIs and make legacy rollback conditional so a concurrent paid purchase can never have `trialUsed` reverted.
4. Add a one-time cursor-batched cleanup script. First mark all clients with historical paid VPN payments; then dry-run or apply lifecycle deletion for their remaining standalone trials. Add a pure planning test so dry-run selection cannot accidentally become a write path.
5. Add an `isExpiredTrial` model helper and render the centered “Пробный период закончился” state with a `/cabinet/tariffs` button in the new cabinet. Add the model test for the exact state predicate.
6. Run targeted tests, backend TypeScript build, frontend model tests, and frontend production build; inspect the diff and leave unrelated user changes untouched.

## Review checklist

- [ ] No direct `prisma.subscription.delete` is introduced for trial cleanup.
- [ ] No new background job or unbounded per-request scan is introduced.
- [ ] Proxy/sing-box/top-up/extra-option payment paths do not burn the trial flag.
- [ ] Paid clients cannot activate either trial flow, including when an old request carries stale `req.client` data.
- [ ] Expired non-trial subscriptions retain their existing cabinet rendering.

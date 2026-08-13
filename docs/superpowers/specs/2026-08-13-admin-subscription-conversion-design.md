# Admin Subscription Conversion Design

**Goal:** Give administrators one preview/apply flow for tariff conversion while preserving the existing Remnawave UUID, short UUID, and subscription link.

## Scope

- Add admin conversion preview and apply endpoints.
- Use one policy function for both preview and apply.
- In single-subscription mode, choose the active canonical owned subscription: `remnawaveUuid != null`, `expireAt > now`, lowest `subscriptionIndex`, then lowest `id`.
- In multi-subscription mode, require the administrator to select the concrete subscription explicitly.
- Reuse the existing tariff activation/conversion service for `grant-extend` and trial conversion.
- Return current tariff, target tariff, remaining days, converted days, total days, source revision, and downgrade commission when applicable.
- Reject an apply request with HTTP 409 when its source revision is stale.
- Record a successful admin conversion in the existing admin audit log.

## API contract

Both endpoints accept the same JSON body:

```ts
{
  targetTariffId: string;
  priceOptionId?: string;
  customDurationDays?: number;
  subscriptionId?: string;
  sourceRevision?: string;
  note?: string;
}
```

`subscriptionId` is required in multi-subscription mode and ignored for source selection in single-subscription mode. Preview returns the policy result plus `sourceRevision`. Apply requires the preview revision and re-evaluates the policy before mutating state.

## Policy

The policy loads the source subscription and target tariff, resolves the selected price option, calculates remaining days from the source expiry, and delegates day conversion to the existing `computeConvertedDays` policy. A downgrade is a target tariff with a lower daily price than the source tariff; only that case exposes a five-percent commission. Trial conversion preserves the source subscription record and invokes the shared conversion path.

The apply path passes `convertMode: true` to the existing activation service. It must not create a replacement subscription or call a reissue operation, so the existing Remnawave UUID, short UUID, and link remain unchanged.

## UI

`SubscriptionRemnaPanel` adds a conversion preview action using the admin API helpers. The preview displays current/target tariff, remaining/converted/total days, and the downgrade commission when present. Apply is disabled while preview data is stale or unavailable and reports HTTP 409 as a refresh-required message.

## Error handling and audit

- Invalid input returns 400.
- Missing client, subscription, or tariff returns 404.
- A subscription without a Remnawave UUID returns 400.
- A stale source revision returns 409 without applying changes.
- Successful apply records `subscription.convert_admin` with source/target IDs, revision, day breakdown, and commission through `logAdmin`.

## Tests

Extend `client-admin-consistency.contract.test.ts` with RED tests for the shared policy marker, canonical single-mode selection, explicit multi-mode selection, preview/apply revision handling, downgrade-only commission, and shared conversion service usage. Run the contract test before implementation to confirm the expected failures, then run it again after the minimal implementation.

## Constraints

- Work from commit `4b6e759` on branch `codex/admin-subscription-conversion`.
- Do not add an owner-only unique database constraint.
- Do not change an existing `remnawaveUuid`, short UUID, or user link except through explicit reissue.
- `multiSubscriptionsEnabled=false` means one subscription; `true` allows multiple subscriptions.
- Do not run production cleanup with `--apply`.

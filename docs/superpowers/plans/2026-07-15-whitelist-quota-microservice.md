# Whitelist Quota Microservice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace composite subscriptions and duplicate Remnawave users with one Remnawave user per STEALTHNET subscription, while enforcing a local GB quota only for nodes in the `WHITELIST` squad.

**Architecture:** STEALTHNET remains the billing and entitlement source. The user has one Remnawave UUID with global traffic limit `0` (unlimited), receives both ordinary tariff squads and the configured whitelist squad, and a standalone quota worker removes only the whitelist squad after its locally accounted quota is exhausted. The worker reads Remnawave usage in batches through a read-only adapter and writes all quota state, notification milestones, and audit records only to STEALTHNET PostgreSQL.

**Tech Stack:** Node.js/TypeScript, Express, Prisma/PostgreSQL, existing Remnawave HTTP client, existing cron registry and Telegram notification paths.

## Global Constraints

- Do not fork or modify Remnawave, Remnawave Node, or Xray.
- Each customer subscription has exactly one `Subscription.remnawaveUuid`; never create a second UUID for whitelist access.
- `Subscription` remains the single billing, renewal, revoke, HWID and administrative entity.
- Existing tariff `internalSquadUuids` remain ordinary unlimited access; existing `trafficLimitBytes` becomes the whitelist quota after migration.
- The actual Remnawave user must always have `trafficLimitBytes = 0` while the quota feature is enabled.
- Quota data, notification state, and audit history live only in STEALTHNET PostgreSQL.
- Read Remnawave storage with a dedicated read-only account; never write to its database.
- Keep commit `de500e5` and its background-tab optimizations. Remove only the composite-subscription feature branch and its deployed artifacts.
- Do not delete legacy secondary-subscription/gift functionality unless the inventory proves it was introduced solely for composite subscriptions.
- No new runtime dependency unless the existing backend stack cannot implement a requirement.

---

## 1. Decisions fixed before implementation

### 1.1 Product semantics

For every active tariff subscription:

```text
ordinary tariff squads      -> unlimited
global WHITELIST squad      -> quota equal to tariff.trafficLimitBytes
Remnawave data limit        -> 0 (unlimited)
```

`trafficLimitBytes = 0` keeps its current meaning: unlimited whitelist traffic.
The WHITELIST squad and its metered node UUIDs are global STEALTHNET settings, not duplicated in every tariff. This preserves every current tariff and makes its existing GB value apply automatically.

### 1.2 Quota lifecycle

```text
purchase / renewal / tariff conversion
  -> ensure one Remnawave user
  -> assign normal tariff squads + WHITELIST squad
  -> set Remnawave data limit to 0
  -> start or reset local whitelist quota

quota exhausted
  -> remove only WHITELIST squad from the same Remnawave user
  -> keep normal squads, expiry, subscription URL, HWIDs and user status intact

top-up / next renewal
  -> reset local quota accounting
  -> re-add WHITELIST squad
```

### 1.3 Notification milestones

Send at most one Telegram notification per quota period at each remaining level:

| Remaining | Event key |
| --- | --- |
| 50% or less | `half` |
| 25% or less | `quarter` |
| 10% or less | `ten` |
| 3% or less | `three` |
| 0% | `exhausted` |

If a single usage sample crosses multiple levels, send all missed warnings in descending order in the same worker run, then mark each as sent. Do not send warnings again after worker restart.

## 2. Capacity result and operating model

### 2.1 What is cheap

Local arithmetic is not a concern:

- 1,000 users × 10 nodes = at most 10,000 counters per pass.
- 20,000 users × 10 nodes = at most 200,000 counters per pass.
- A PostgreSQL upsert of 20,000 local quota rows and 200,000 additions is small for the current stack; storage is tens of MB, not GB.

### 2.2 What must not be done

Do **not** call Remnawave `GetStatsUserUsageCommand` for every user every minute. The official command is per-user and performs several aggregates internally. At 20,000 users this is approximately:

| Poll interval | HTTP requests/sec | approximate Remnawave aggregate queries/sec |
| --- | ---: | ---: |
| 1 minute | 333 | 1,000 |
| 5 minutes | 67 | 200 |
| 15 minutes | 22 | 67 |

The one-minute version will create unnecessary CPU, JSON and PostgreSQL pressure on the Remnawave panel. It also couples quota availability to its public statistics endpoint.

### 2.3 Required scalable reader

Implement one `WhitelistUsageReader` adapter with a read-only PostgreSQL connection to the Remnawave database. Its query must return aggregate bytes grouped by `(remnawave_user_id, whitelist_node_id)` for only:

- the configured ten metered node IDs;
- subscriptions with an active whitelist quota;
- usage newer than each quota's accounting cursor.

The adapter must use the actual indexed `nodes_user_usage_history` layout of the installed Remnawave version. It must be verified by an integration test before any migration. It does **not** alter Remnawave and remains outside its upgrade path; a pre-upgrade compatibility check is the only maintenance obligation.

With this batch reader, the worker is one or a few SQL reads per run rather than 20,000 HTTP requests. Start at a five-minute cadence for all active quotas. Add a one-minute cadence only for subscriptions already below 10% remaining; this caps normal production load while keeping the final warning and cutoff reasonably prompt. Exact byte-level cutoff is impossible without a core fork; maximum overspend is bounded by the sampling interval plus an already-open connection.

## 3. Composite-subscription removal boundary

The following design is explicitly rejected and must be removed: `RemnawaveComponent`, `TariffRemnawaveComponent`, component merge endpoints, multi-upstream subscription merging, component reconciliation, and creation of a second Remnawave user for whitelist access.

The untracked design document [ARCHITECTURE_COMPOSITE_SUBSCRIPTIONS.md](/Users/sallyqx/Documents/projects/remnawave-STEALTHNET-Bot/docs/ARCHITECTURE_COMPOSITE_SUBSCRIPTIONS.md) is the inventory source for that removal. Review the actual branch diff and deployed server state before deletion; it contains plans for generic components that must not survive under a renamed form.

Existing `SecondarySubscription` records are older, independently used features for gifts/trials/multiple logical subscriptions. Their deletion is out of scope unless a particular field, route or migration is proven to be composite-only.

## 4. File map

| Path | Change | Responsibility |
| --- | --- | --- |
| `backend/prisma/schema.prisma` | Modify | Whitelist settings, quota and notification/audit models; remove composite-only models. |
| `backend/prisma/migrations/20260715000000_whitelist_quota/migration.sql` | Create | Safe schema/data migration, indexes and composite cleanup after backup. |
| `backend/src/modules/whitelist-quota/whitelist-quota.service.ts` | Create | Transactional quota lifecycle and squad changes. |
| `backend/src/modules/whitelist-quota/whitelist-usage.reader.ts` | Create | Read-only, batched usage adapter to Remnawave PostgreSQL. |
| `backend/src/modules/whitelist-quota/whitelist-quota.worker.ts` | Create | Scheduled accounting, warning dispatch and exhaustion handling. |
| `backend/src/modules/whitelist-quota/whitelist-quota.routes.ts` | Create | Internal/admin settings and read-only quota status endpoints. |
| `backend/src/modules/remna/remna.client.ts` | Modify | Reuse the sole Remnawave transport layer for squad membership and one-user updates. |
| `backend/src/modules/tariff/tariff-activation.service.ts` | Modify | Apply/reset whitelist quota as part of existing successful activation and renewal. |
| `backend/src/modules/payment/auto-renew.cron.ts` | Modify | Re-enable quota after a successful auto-renew through the central service only. |
| `backend/src/modules/diagnostics/cron-registry.ts` | Modify | Register the quota worker and health diagnostics. |
| `backend/src/modules/sync/sync.service.ts` | Modify | Never recreate a missing whitelist secondary user; reconcile only one UUID and squad membership. |
| `backend/src/modules/admin/admin.routes.ts` | Modify | Remove composite-only operations; expose quota status/actions in the existing subscription context. |
| `frontend/src/pages/admin-secondary-subscriptions.tsx` | Delete only if composite-only | Remove only after the inventory proves this page was introduced exclusively for components. |
| `frontend/src/components/layout/dashboard-layout.tsx` | Modify | Remove composite-only navigation; add a quota view only inside the normal client/subscription card. |
| `frontend/src/pages/cabinet/client-dashboard.tsx` | Modify | Show one subscription and whitelist quota remaining; remove component/secondary presentation. |
| `frontend/src/lib/api.ts` | Modify | Remove composite-only API types/methods and add quota status/settings calls. |
| `docs/ARCHITECTURE_COMPOSITE_SUBSCRIPTIONS.md` | Delete | Retire rejected architecture after branch inventory. |
| `docs/superpowers/plans/2026-07-15-background-admin-work-plan.md` | Preserve | Background-tab optimization plan remains valid. |

## 5. Implementation slices

### Task 1: Freeze and inventory the composite feature

**Files:** branch diff, deployed server diff, `docs/ARCHITECTURE_COMPOSITE_SUBSCRIPTIONS.md`.

- [ ] Back up the STEALTHNET and Remnawave PostgreSQL databases, deployment directory, and the current composite branch SHA.
- [ ] Produce a machine-readable inventory of composite-only Prisma models, migrations, routes, cron jobs, frontend pages and environment variables.
- [ ] Classify every secondary-subscription reference as either `legacy-gift-trial` or `composite-only`; do not infer from the name.
- [ ] Disable creation of new composite subscriptions before migration, leaving existing accounts readable until the cutover completes.
- [ ] Verify `de500e5` remains in the target branch and no removal step reverts `use-page-visibility.ts` or lazy route loading.
- [ ] Commit only the inventory and a reversible feature flag change.

### Task 2: Validate the Remnawave usage source

**Files:** `backend/src/modules/whitelist-quota/whitelist-usage.reader.ts`, test fixture/database.

- [ ] Create a read-only PostgreSQL role restricted to `SELECT` on the precise Remnawave usage tables required by the installed version.
- [ ] On a staging copy, generate known traffic on two whitelist nodes and one normal node for one test user.
- [ ] Implement a small read-only spike that returns `(remnawaveUuid, nodeUuid, bytes)` for only the whitelist nodes.
- [ ] Compare the spike result with Remnawave's User → Show Usage UI and confirm normal-node traffic is excluded.
- [ ] Verify whether the source is a monotonic total or interval deltas. Choose one explicit accounting rule:
  - monotonic total: store per-node `baselineBytes` at entitlement start;
  - interval deltas: store a per-node cursor and add only unseen deltas to STEALTHNET `usedBytes`.
- [ ] Add an explain-plan check proving the batch query uses indexes and does not scan all history rows.
- [ ] Benchmark 1,000 and simulated 20,000 quota records. Acceptance target: batch read + local update under 5 seconds at 20,000 users on staging-equivalent hardware.
- [ ] Commit the adapter contract and benchmark result before adding payment behaviour.

### Task 3: Add the isolated local quota data model

**Files:** `backend/prisma/schema.prisma`, a new Prisma migration.

Create these models; names are deliberately quota-specific, not generic components:

```text
WhitelistQuota
  id, subscriptionId (unique), remnawaveUuid
  limitBytes, usedBytes, status (ACTIVE | EXHAUSTED | DISABLED)
  startedAt, lastAccountedAt, exhaustedAt
  whitelistSquadUuid, createdAt, updatedAt

WhitelistQuotaNodeCursor
  id, quotaId, nodeUuid (unique within quota)
  baselineBytes OR cursor value, updatedAt

WhitelistQuotaNotification
  id, quotaId, milestone (HALF | QUARTER | TEN | THREE | EXHAUSTED)
  sentAt, unique(quotaId, milestone)

WhitelistQuotaAudit
  id, quotaId, event, bytesBefore, bytesAfter, detailJson, createdAt

WhitelistQuotaSettings
  singleton id, enabled, whitelistSquadUuid, meteredNodeUuids, normalPollSeconds,
  urgentPollSeconds, createdAt, updatedAt
```

- [ ] Add foreign keys and indexes for active quota scans: `(status, lastAccountedAt)`, `(quotaId, nodeUuid)`, and `(quotaId, milestone)`.
- [ ] Write migration tests for existing tariffs, subscriptions and secondary gift/trial records.
- [ ] Backfill settings disabled by default; no user gains or loses access during schema deployment.
- [ ] Commit schema and migration separately from business logic.

### Task 4: Implement quota entitlement and one-user squad operations

**Files:** `whitelist-quota.service.ts`, `remna.client.ts`.

- [ ] Implement `activateWhitelistQuota(subscriptionId)` as one transaction: read the subscription/tariff, verify configuration, set the one Remnawave user's global traffic limit to `0`, merge normal tariff squads with the whitelist squad, snapshot node cursors, then create/reset the local quota.
- [ ] Implement `exhaustWhitelistQuota(quotaId)`: remove only `whitelistSquadUuid` from that user's active squads, mark local quota `EXHAUSTED`, and write an audit event. It must be idempotent.
- [ ] Implement `resetWhitelistQuota(subscriptionId)`: retain the same UUID, refresh cursors, zero local `usedBytes`, clear notification rows, and restore the whitelist squad if the tariff limit is greater than zero.
- [ ] Use row locking/transactional status changes so two worker runs cannot remove/re-add the squad inconsistently.
- [ ] Add unit tests for: no duplicate UUID creation, regular squads remain after exhaustion, zero tariff quota stays unlimited, retry after Remnawave timeout, and renewal after exhaustion.
- [ ] Commit the service with its tests.

### Task 5: Implement the worker and notifications

**Files:** `whitelist-quota.worker.ts`, `cron-registry.ts`, existing notification service.

- [ ] Register a single leader-safe cron worker; do not start one process per user.
- [ ] In one run, fetch usage once in batches, calculate each quota's delta locally, update `usedBytes`, and emit immutable audit events.
- [ ] Poll `ACTIVE` quotas every five minutes. Poll quotas at or below 10% remaining every minute. Skip `EXHAUSTED` and `DISABLED` quotas.
- [ ] Send milestones using the unique notification row as the idempotency key.
- [ ] On `usedBytes >= limitBytes`, send `EXHAUSTED` once and call `exhaustWhitelistQuota`.
- [ ] Export diagnostics: last successful run, duration, active quotas, failed reads, exhausted today, and maximum observed overshoot.
- [ ] Test worker restart, duplicate cron delivery, node unavailability, partial batch failure, and crossing all milestones in one sample.
- [ ] Commit worker, notifications and diagnostics.

### Task 6: Connect existing tariff, payment and renewal flows

**Files:** `tariff-activation.service.ts`, `auto-renew.cron.ts`, current payment activation callers.

- [ ] At the single successful activation point, replace the global Remnawave traffic limit update with `activateWhitelistQuota`/`resetWhitelistQuota`.
- [ ] Preserve all existing `expireAt`, device-limit, promo, gift, trial and auto-renew calculations.
- [ ] For old active subscriptions, calculate the first quota from their current tariff and initialize cursor/baseline at cutover; no historical whitelist bytes are charged retroactively.
- [ ] Keep a tariff's normal `internalSquadUuids` unchanged and use its existing `trafficLimitBytes` as the local whitelist limit.
- [ ] Ensure tariff editing applies to subscriptions at their next defined activation/renewal, matching current tariff snapshot rules; do not silently reset an active quota merely because an admin edited a tariff.
- [ ] Add end-to-end tests for purchase, manual renewal, auto-renew, tariff conversion, trial conversion and revoke.
- [ ] Commit this integration after all flows pass.

### Task 7: Remove composite code and repair UX

**Files:** all items classified `composite-only` in Task 1.

- [ ] Remove component models/migrations/endpoints and subscription merging introduced by the composite branch.
- [ ] Delete component-only UI, navigation and client API calls; retain legacy gifts/trials where their inventory classification requires it.
- [ ] In the normal subscription card, display: `Whitelist: used / limit`, remaining GB, current status and next reset/expiry context.
- [ ] Add admin settings for enabled flag, whitelist squad selection and exactly ten metered node UUIDs; validate that each selected node is accessible through the configured squad before saving.
- [ ] Add an admin action to recheck/reconcile one quota and a read-only audit timeline. Do not add a second subscription management page.
- [ ] Remove `ARCHITECTURE_COMPOSITE_SUBSCRIPTIONS.md` only after the deployed composite tables/data are migrated or archived.
- [ ] Build the frontend and run regression checks for the existing admin background optimizations.
- [ ] Commit removal separately from quota implementation for a clean rollback boundary.

### Task 8: Cutover and rollback-safe migration

- [ ] Reconcile every affected customer to one chosen main UUID, preserving its subscription URL, HWIDs, expiry and normal squads.
- [ ] Archive the extra composite UUID mapping before deleting any unused Remnawave user.
- [ ] Initialize each active whitelist quota with a fresh accounting baseline/cursor, add the whitelist squad, and set the main user's global limit to zero.
- [ ] Run the worker in observe-only mode for 24 hours: calculate usage and notifications but do not remove squads; compare sampled results with the Remnawave UI.
- [ ] Enable enforcement first for internal test accounts, then 1% of active quota subscriptions, then all accounts after one full billing day without discrepancies.
- [ ] Keep a `WHITELIST_QUOTA_ENFORCEMENT=false` kill switch: it pauses removals without changing ordinary access or deleting local accounting data.
- [ ] Document the pre-upgrade check: run usage adapter integration test against a new Remnawave version before updating the panel.

## 6. Acceptance criteria

- A paid user has one STEALTHNET `Subscription` and one Remnawave UUID.
- The user receives one subscription URL and sees one subscription in cabinet and admin views.
- Normal tariff squads continue to work after whitelist quota reaches zero.
- Whitelist nodes disappear from the user's available nodes after the quota worker exhausts the package.
- Renewing or topping up restores only the whitelist squad and resets local quota accounting.
- Revoke, disable, deletion, HWID and expiry operate on the same one UUID.
- All four warnings and the exhaustion warning are sent once per quota period.
- At 20,000 active quotas and ten metered nodes, accounting completes under five seconds per five-minute run in staging, with no per-user Remnawave HTTP fan-out.
- A Remnawave upgrade can be validated by one read-only adapter integration test; no fork needs rebasing.

## 7. Research evidence

Remnawave documents a user-level data limit and independently assigns one or more squads; it does not expose per-squad data limits. The exact request is an active Remnawave feature discussion. Community guidance there uses one user, a dedicated squad, a local entitlement table, per-node usage baseline and removal from that squad on exhaustion. See [Remnawave user model](https://docs.rw/learn-en/users/) and [the per-node quota discussion](https://f.docs.rw/t/topic/217).

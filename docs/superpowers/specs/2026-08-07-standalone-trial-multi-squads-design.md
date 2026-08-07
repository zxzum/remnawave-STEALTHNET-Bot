# Standalone Trial Multi-Squad Design

**Date:** 2026-08-07

## Goal

Make the standalone trial editor behave like a self-contained tariff assembled
from several Remnawave internal squads, while preserving existing trial data and
the current local-quota model.

## Current root cause

The database and admin API already store standalone squads as `Trial.squadUuids`
and accept an array. The frontend editor reduces that array to one `squadUuid`,
renders a single native select, and sends `squadUuids: [squadUuid]`. This is why
the form cannot create a multi-squad standalone trial.

Squad loading is also silent: the request runs after the dialog opens, with no
loading state, and any request/response-shape error becomes an empty list.

## Design

### Editor

Rename the standalone source label to `Из сквадов (самостоятельный тариф)` and
replace the single standalone squad select with a multi-select control. The
control shows every loaded internal squad with a checkbox and keeps the selected
UUIDs in stable order.

The payload remains the existing API contract:

```ts
{
  tariffId: null,
  squadUuids: string[],
  deviceLimit: number,
  // existing duration, traffic, conversion and enabled fields
}
```

No Prisma migration or backend contract change is required.

### Local quota

When `trafficLimitMode` is `LOCAL_SQUAD`, `meteredSquadUuid` must be one of the
selected standalone squads. The editor lists only selected squads in the
metered-squad selector and rejects saving when none is selected or the metered
squad is outside the selected set.

The existing quota remains one metered squad per subscription. Traffic from
other selected squads is available to the user but is not added to this quota.
Summing traffic across all selected squads is deliberately out of scope because
it would require changing the quota model and worker accounting.

### Loading and compatibility

The editor shows a loading state while internal squads are fetched and an
actionable error when loading fails. Existing response shapes remain accepted.

Existing standalone trials with one squad are initialized with one selected
UUID, save unchanged, and continue to activate and convert through the existing
trial flow. Tariff-based trials remain unchanged and continue inheriting all
squads from their tariff.

## Verification

- A standalone trial can select and submit multiple squad UUIDs.
- Editing an existing one-squad trial keeps its selected squad.
- Local-quota selection is restricted to selected squads.
- Empty selection and invalid metered-squad selection cannot be saved.
- Squad loading displays progress and a visible error instead of silently
  rendering an empty selector.
- Existing backend trial activation, local quota creation, purchase conversion,
  and old single-squad data remain untouched.

## Intentionally skipped

- Database changes.
- Changes to tariff-based trials.
- Aggregate local quota across several squads.
- New Remnawave endpoints or dependencies.

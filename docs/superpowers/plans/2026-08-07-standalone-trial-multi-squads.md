# Standalone trial with multiple squads — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let an admin build a standalone trial from several internal squads while preserving the existing trial payload, activation, conversion, and local-quota behavior.

**Architecture:** Keep the existing backend `Trial.squadUuids` JSON contract. Add a tiny frontend helper for parsing squad responses and toggling UUIDs, then make `TrialFormDialog` render a checkbox list, submit all selected UUIDs, and expose loading/error states for the Remnawave squad request.

**Tech Stack:** React, TypeScript, Vite, existing `node:test`/`tsx` tooling; no dependency or database changes.

## Constraints

- The product is Лазейка ВПН; existing `stealthnet` identifiers remain compatibility names.
- Existing tariff-based trials remain unchanged.
- Existing standalone trials with one UUID must load and save unchanged.
- `tariffId` remains `null` for standalone trials; `squadUuids` remains an array.
- A `LOCAL_SQUAD` trial still has one `meteredSquadUuid`; it must be one of the selected squads.
- Do not silently turn a failed squad request into an empty successful form.

### Task 1: Add the smallest testable squad-selection contract

**Files:**

- Create: `frontend/src/lib/trial-squads.ts`
- Create: `frontend/scripts/trial-squads.test.mjs`

- [ ] Write failing tests for:
  - parsing the existing wrapped `{ response: { internalSquads } }` response;
  - filtering malformed/duplicate squad records;
  - toggling a UUID without changing the order of the remaining selections;
  - keeping a selected metered squad only when it belongs to the selected UUIDs.
- [ ] Run the focused test and confirm it fails because the helper does not exist.
- [ ] Implement only the helper functions needed by the form: response parsing, UUID toggling, and metered-squad validation.
- [ ] Run the focused test and confirm it passes.

Run from the repository root:

```bash
rtk npm --prefix backend exec -- tsx --test ../frontend/scripts/trial-squads.test.mjs
```

### Task 2: Make the standalone trial form multi-squad

**Files:**

- Modify: `frontend/src/pages/trials.tsx`

- [ ] Replace the singular `squadUuid` state with `squadUuids`, initialized from all saved UUIDs so old one-squad trials remain compatible.
- [ ] Change the source label to `Из сквадов (самостоятельный тариф)` and replace the native single-select with an accessible checkbox list.
- [ ] Submit all checked UUIDs in the existing `squadUuids` field and validate that at least one is selected.
- [ ] Populate the local-quota metered-squad selector from all selected standalone squads, while preserving the tariff-based selector.
- [ ] Keep the existing one-squad `meteredSquadUuid` rule and show a validation error if it is not among the selected squads.
- [ ] Parse the API response through the helper, show loading state while squads are requested, show an explicit error and retry action on failure, and show an empty state when the response has no usable squads.
- [ ] Preserve unknown saved UUIDs in the form payload if Remnawave temporarily omits them, so editing does not erase data.

### Task 3: Verify the compatibility surface

**Files:** no additional files unless a focused regression check needs one.

- [ ] Run the focused helper test.
- [ ] Run `rtk npm --prefix frontend run build`.
- [ ] Run `rtk npm --prefix backend test -- --test-name-pattern='trial|squad'` to cover the existing backend contract and activation tests.
- [ ] Review `git diff --check` and confirm only the helper, focused test, form, and this plan are touched by this implementation.
- [ ] Do not change Prisma schema, backend routes, conversion code, or worker behavior because the existing backend already handles the multi-squad array.

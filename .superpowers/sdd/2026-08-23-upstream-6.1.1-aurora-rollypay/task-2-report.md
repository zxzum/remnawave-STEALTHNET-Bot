# Task 2 Report: Broadcast completion and persistent backup retention

## Status

Implemented and committed on `codex/upstream-6.1.1-aurora-rollypay`.

Code commit: `43157b1 fix: complete broadcasts and retain backups`

## Implemented

- Adapted upstream commits `586b707` and `a1c09fd` to the current database-backed broadcast queue.
- Telegram SVG, HEIC/HEIF, TIFF, and icon MIME types now use document delivery; raster image types retain photo delivery.
- Terminal broadcast jobs expose their persisted result, including completed, cancelled, and error states.
- Added a five-minute stale-job scheduler. Pending or running jobs older than 15 minutes are atomically moved to `error` with a worker recovery hint. The scheduler is started and stopped with the API.
- Frontend broadcast polling now returns a fallback result when a completed job has no result and keeps the existing terminal handling for cancelled/error jobs. Polling slows from 1.5 seconds to 5 seconds after two minutes.
- Added `deleteExpiredBackups(retentionDays, now?)`; it deletes only expired `.sql` files whose resolved paths remain beneath `BACKUPS_DIR`. Cutoff-date files and non-SQL files are retained.
- Automatic backups run 30-day retention cleanup after creating the backup, without preventing Telegram delivery if cleanup fails.
- Added the persistent Compose volume `backups_data:/app/backups`.

## TDD and verification

Red phase:

- `rtk npx --no-install tsx --test src/modules/broadcast/broadcast-result.test.ts src/modules/backup/backup-retention.test.ts`
- Failed as expected because the stale scheduler/module and retention export were not implemented.

Green/final checks:

- Focused Task 2 tests: 4 passed, 0 failed.
- Backend package tests: 31 passed, 0 failed.
- `backend`: `npm run build` passed.
- `frontend`: `npm run build` passed.
- `git diff --check` and staged `git diff --cached --check` passed.
- Compose structure check passed with Ruby: `backups_data` is declared and mounted at `/app/backups`.

## Concerns

- Docker CLI is unavailable locally, so `docker compose config` could not run; runtime Compose validation remains for an environment with Docker.
- The automatic cleanup period is a fixed 30 days because the brief specifies the retention function but no user-facing retention setting.
- Existing non-blocking Node deprecation and test logging warnings remain unchanged.

## Round 1/5 review fixes

### Findings addressed

1. Stale-job errors are now terminal and durable. Worker finalization uses
   `updateMany({ where: { id, status: "running" } })`; if the stale scheduler
   has already changed the row to `error`, the worker update affects zero rows
   and returns without overwriting the terminal state.
2. Completed broadcast results now set `ok` to false when persisted failed
   Telegram/email counts, persisted errors, or a persisted error message show a
   failure. Terminal polling behavior is unchanged, so the frontend receives
   the partial-failure result and does not clear the form.

### TDD evidence

Red:

- `rtk npx --no-install tsx --test src/modules/broadcast/broadcast-result.test.ts`
- 4 tests ran: 2 passed, 2 failed. The partial-failure assertion observed
  `actual ok: true`; the worker race contract observed unconditional
  `broadcastHistory.update` finalization.

Green:

- `rtk npx --no-install tsx --test src/modules/broadcast/broadcast-result.test.ts src/modules/backup/backup-retention.test.ts`: 5 passed, 0 failed.
- `rtk npm test`: 31 passed, 0 failed.
- `rtk npm run build` in `backend`: passed.
- `rtk npm run build` in `frontend`: passed.

### Round 1 commit

Code/test commit: `2983fa1 fix: preserve broadcast terminal results`.
The report append is committed separately after this entry. Backup files and
backup behavior were not changed.

# Task 6: version 6.2.0 and release checks

## Status

Implemented for Лазейка ВПН.

Commit: `07374c5` (`chore: release 6.2.0`).

## Changes

- Added root `version.json` with `6.2.0`.
- Set backend, frontend, and bot package versions plus package-lock root versions to `6.2.0`.
- Updated the backend startup log, admin `/version` response, and frontend version badge to `6.2.0`.
- Preserved Лазейка ВПН branding and made no dependency changes or feature-behavior changes.

## Verification

All requested release checks passed:

| Check | Result |
| --- | --- |
| `rtk npm test` from `backend` | 31 passed, 0 failed |
| `rtk npm run build` from `backend` | Passed |
| `rtk npm run build` from `frontend` | Passed; 3855 modules transformed |
| `rtk npm run build` from `bot` | Passed |
| Frontend cabinet-design resolver | 1 passed, 0 failed |
| Backend cabinet-design contract | 1 passed, 0 failed |
| Canonical subscription resolver contract | 14 passed, 0 failed |
| RollyPay focused contracts | 23 passed, 0 failed |
| Version/dependency invariant assertion | Passed; only root versions changed |
| `rtk git diff --check` | Clean |

Focused commands used:

```text
frontend: rtk node --experimental-strip-types --test src/lib/cabinet-design.test.mjs
backend: rtk npm exec -- tsx --test src/modules/client/cabinet-design.contract.test.ts
backend: rtk npx --no-install tsx --test src/modules/subscription/canonical-activation.test.ts
backend: rtk npx --no-install tsx --test src/modules/rollypay/rollypay.service.test.ts src/modules/webhooks/rollypay-webhook-policy.test.ts src/modules/payment/rollypay-round1.contract.test.ts src/modules/payment/rollypay-round2.contract.test.ts src/modules/client/rollypay-task4.contract.test.ts
```

## Integration review

Reviewed the final integration diff against `fc6386c`. There are no deleted, renamed, or copied paths. The local subscription, trial, squad, and cabinet paths remain present; the scoped path count increased from 74 to 79 because the Aurora contract/shell files were added. No local subsystem was replaced.

The backup branch `codex/backup-main-before-6.2.0-20260823` exists at `fc6386c`, as does `main`. The requested `backups/main-before-6.2.0-20260823.bundle` file is absent.

## Concerns

- Docker CLI is unavailable (`rtk docker --version` exited 127). No runtime Compose validation is claimed; Compose structure was previously checked.
- An additional broad `frontend/src/cabinet/runtime.test.mjs` run has one pre-existing assertion failure because `frontend/src/App.tsx` still contains an archived `import("@/pages/cabinet/...")` path. This is outside the version-only scope and was not changed.
- Existing Node `DEP0205` deprecation warnings, the intentional backend simulated Remnawave-unavailable log, and the frontend large-chunk warning remain non-blocking.

# Public Subscription React Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `/api/sub/:token` as a cabinet-styled React page in browsers while preserving the existing VPN-client response.

**Architecture:** The backend keeps content negotiation on the existing route, serves the existing SPA shell to browsers, and exposes a no-store public JSON model. A focused React route renders that model with the cabinet design system and existing subscription-page configuration.

**Tech Stack:** Express, TypeScript, React 18, React Router, Tailwind, shadcn/ui, qrcode.react, Lucide.

## Global Constraints

- Keep `/api/sub/:token` unchanged for VPN clients.
- Add no dependencies.
- Reuse cabinet UI primitives and subscription guide configuration.
- Keep anonymous data limited to values already present in the public HTML page.
- Create a fresh production backup before deployment.

---

### Task 1: Public subscription JSON model and browser routing

**Files:**
- Modify: `backend/src/modules/subscription/composite-subscription.routes.ts`
- Modify: `backend/src/modules/subscription/public-subscription-page.ts`
- Test: `backend/src/modules/subscription/public-subscription-page.test.ts`

**Interfaces:**
- Produces: `GET /api/public/subscription-page/:publicSubscriptionToken` returning `PublicSubscriptionPageModel`.
- Preserves: non-browser `GET /api/sub/:publicSubscriptionToken` response.

- [x] **Step 1: Write failing assertions**

Add assertions that the public model contains the subscription URL, quotas, guide config and only squad-accessible hosts, and that browser handling delegates to the SPA renderer rather than producing legacy page markup.

- [x] **Step 2: Verify RED**

Run: `cd backend && npx tsx --test src/modules/subscription/public-subscription-page.test.ts`

Expected: failure because the new public model/route contract does not exist.

- [x] **Step 3: Implement the minimal backend contract**

Extract the existing browser data assembly into one async helper used by the JSON route. In the browser branch of `/api/sub/:token`, call `renderSpaIndex(req, res)` after token validation. Keep the raw subscription branch unchanged.

- [x] **Step 4: Verify GREEN**

Run the targeted test again and expect all tests to pass.

### Task 2: Public React subscription screen

**Files:**
- Create: `frontend/src/pages/public-subscription.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `GET /api/public/subscription-page/:token`.
- Produces: public React route `/api/sub/:publicSubscriptionToken`.

- [x] **Step 1: Record failing rendered expectations**

Open the current route and verify it lacks the React page identity, working QR dialog, responsive access-card grid and guide fallback behavior.

- [x] **Step 2: Implement the route and page**

Use existing `Card`, `Button`, `Dialog`, `QRCodeSVG`, theme tokens and guide data. Render access cards first, then `Ваша подписка`, then guide cards and available locations. Fetch once on token change with `AbortController`; derive platform and selected guide from state without duplicate effects.

- [x] **Step 3: Preserve interactions**

Copy the public URL, render QR, generate deeplink proxy URLs, detect unsuccessful app launch and scroll to the matching guide, switch platform/app tabs, and retry failed JSON loading.

- [x] **Step 4: Build**

Run: `cd frontend && npm run build`

Expected: TypeScript and Vite complete with exit code 0.

### Task 3: Visual QA, commit, backup and deploy

**Files:**
- No production file additions beyond Tasks 1–2.

**Interfaces:**
- Verifies: browser SPA, JSON endpoint, VPN response, desktop/mobile layout and interactions.

- [ ] **Step 1: Browser QA**

Test desktop and mobile. Check page identity, non-blank DOM, console, screenshot, QR, copy, platform/app tabs and fallback scroll.

- [ ] **Step 2: Compare references**

Use `view_image` for both supplied screenshots and the latest browser screenshots. Fix mismatches in order, glass surfaces, typography, spacing, badges, progress bar and mobile stacking.

- [ ] **Step 3: Verify repository changes**

Run backend targeted tests, frontend build and `git diff --check`.

- [ ] **Step 4: Commit only task files**

Stage the backend route/helper/test, new React page, the `App.tsx` route hunk and this plan. Preserve all unrelated working-tree changes.

- [ ] **Step 5: Back up and deploy**

Create a timestamped tar archive under `/opt/backups`, upload only changed source files, rebuild API/frontend, recreate services, and verify health plus external HTTP behavior.

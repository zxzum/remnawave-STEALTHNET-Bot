# Device-aware Public Subscription Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing public subscription page dark, database-branded, device-aware, Remnawave-like, and show collapsible eligible hosts.

**Architecture:** Keep the existing backend-rendered page and route. Extend its model with database branding and filtered host remarks; use native HTML/CSS and a small inline script for platform/app selection and best-effort deep-link fallback.

**Tech Stack:** TypeScript, Express, Node test runner, server-rendered HTML/CSS/JavaScript.

## Global Constraints

- Do not add endpoints, services, frontend bundles, or dependencies.
- Keep VPN-client content negotiation unchanged.
- Keep database branding separate from subscription-page application JSON.
- Host lookup failure must not break the page.
- The public page is dark by default.

---

### Task 1: Renderer behavior

**Files:**
- Modify: `backend/src/modules/subscription/public-subscription-page.test.ts`
- Modify: `backend/src/modules/subscription/public-subscription-page.ts`

**Interfaces:**
- Consumes: existing `renderPublicSubscriptionPage(model)`.
- Produces: model fields `brandName: string`, `brandLogo: string | null`, `hosts: string[]`; exported `availableHostNames(value: unknown, squadUuids: string[]): string[]`.

- [ ] **Step 1: Write failing tests**

Add assertions that database branding wins over `brandingSettings.title`, an allowed image logo is rendered, dark `color-scheme` is emitted, platform/app controls and one-guide-at-a-time attributes exist, top Happ/INCY links carry guide fallback metadata, and hosts render inside a collapsed `<details>`.

Add a focused `availableHostNames` test using enabled, disabled, hidden, duplicated, and squad-excluded hosts. Expect only unique remarks accessible to at least one supplied squad.

- [ ] **Step 2: Verify RED**

Run: `npm test --prefix backend -- src/modules/subscription/public-subscription-page.test.ts`

Expected: FAIL because the model fields, controls, and host helper do not exist.

- [ ] **Step 3: Implement the minimum renderer change**

Extend `PublicSubscriptionPageModel`, validate logo sources, add `availableHostNames`, replace the light CSS with dark CSS, render a native platform select, wrapping application buttons, one guide panel per app, and collapsed compact host cards. Keep the two top quick links.

Add one inline script that detects iOS/Android/macOS/Windows/Linux from `navigator.userAgent`, selects the first available fallback, switches app guide panels, copies the URL, and scrolls to a matching guide only when a quick deep-link leaves the page visible.

- [ ] **Step 4: Verify GREEN**

Run: `npm test --prefix backend -- src/modules/subscription/public-subscription-page.test.ts`

Expected: all focused tests pass.

### Task 2: Route data and regression verification

**Files:**
- Modify: `backend/src/modules/subscription/composite-subscription.routes.ts`

**Interfaces:**
- Consumes: `getSystemConfig().serviceName`, `getSystemConfig().logo`, `remnaGetHosts()`, `availableHostNames(...)`.
- Produces: complete `PublicSubscriptionPageModel` for the existing renderer.

- [ ] **Step 1: Wire existing data sources**

Import `remnaGetHosts` and `availableHostNames`. Fetch users and hosts concurrently in the browser branch, collect component squad UUIDs, tolerate a failed host response, and pass `brandName`, `brandLogo`, and filtered `hosts` to the renderer.

- [ ] **Step 2: Verify backend**

Run: `npm test --prefix backend && npm run build --prefix backend && git diff --check`

Expected: 39 tests pass, TypeScript exits 0, and diff check is clean.

- [ ] **Step 3: Commit**

Run: `git add backend/src/modules/subscription/public-subscription-page.ts backend/src/modules/subscription/public-subscription-page.test.ts backend/src/modules/subscription/composite-subscription.routes.ts docs/superpowers/plans/2026-07-14-public-subscription-page-device.md && git commit -m "feat: improve public subscription guide"`

### Task 3: Deploy and visual QA

**Files:** none.

**Interfaces:** existing server `bot` and public subscription URL.

- [ ] **Step 1: Deploy without GitHub**

Transfer the new commits with a git bundle, fast-forward `/opt/remnawave-STEALTHNET-Bot`, preserve its existing dirty files, rebuild only `api`, and restart `api` plus `broadcast-worker`.

- [ ] **Step 2: Verify protocol compatibility**

Check browser HTML plus Happ, V2RayTun, Koala, and unknown-client responses. Expected client content types and `X-Stealthnet-Client` headers remain unchanged.

- [ ] **Step 3: Verify rendered behavior**

In Browser, verify desktop and 390x844 mobile views, database logo/name, dark theme, automatic platform selection, application-button switching, one visible guide, collapsed/expanded host list, no overflow, and no relevant console errors. Do not activate external application links.

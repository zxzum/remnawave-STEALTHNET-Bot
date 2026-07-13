# Cabinet Loading Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix node-menu layering and reduce Stealth cabinet first-load payload and misleading loading states so the correct UI appears within 1–2 seconds.

**Architecture:** Keep bot API compatibility while adding a lightweight web representation with versioned asset URLs. Inject critical visual settings into SSR HTML, deduplicate client requests, prefetch subscription config, and gate empty states on completed loading.

**Tech Stack:** Express, TypeScript, React 18, Vite, Tailwind CSS, Framer Motion, Docker Compose, nginx.

## Global Constraints

- Preserve all existing server changes and secrets in the dirty worktree.
- Keep `/api/public/config` unchanged for the Telegram bot.
- Show `Loading preview` until subscription configuration is resolved.
- Keep rollback backup `/opt/backups/vpn-load-speed-20260713-105158` intact.
- Do not modify database data as part of this deployment.

---

### Task 1: Capture failing production regressions

**Files:**
- Create: `scripts/check-loading-performance.sh`

**Interfaces:**
- Consumes: live `https://bot.lazeika.xyz` endpoints and relevant source files.
- Produces: non-zero exit until HTML/config size, node z-index, and loading guard requirements are implemented.

- [ ] Write checks asserting web config and SPA HTML are below 500 KB, the active card receives an elevated z-index, and the empty-app warning is guarded by loading completion.
- [ ] Run the script and confirm it fails against the current implementation with multi-megabyte size output.

### Task 2: Lightweight web assets and configuration

**Files:**
- Modify: `backend/src/modules/client/bot-assets.routes.ts`
- Modify: `backend/src/modules/client/client.routes.ts`

**Interfaces:**
- Produces: `configuredAssetUrl(value, key, origin?)` and `GET /api/public/brand-asset/:key`.
- Produces: `GET /api/public/config?target=web`, compatible with `PublicConfig` but with URL-backed images and without `logoBot`.

- [ ] Add failing route/size assertions to the regression script.
- [ ] Implement deterministic SHA-256 versioned asset URLs and byte responses for `logo`, `favicon`, and `stealth-hero`.
- [ ] Transform only `target=web` responses; leave the default response untouched for the bot.
- [ ] Build backend and run the regression checks that cover this task.

### Task 3: Correct first paint from SSR bootstrap

**Files:**
- Modify: `backend/src/modules/branding/spa-html.ts`
- Create: `frontend/src/lib/public-bootstrap.ts`
- Modify: `frontend/src/lib/use-cabinet-design.ts`
- Modify: `frontend/src/pages/cabinet/stealth/stealth-layout.tsx`

**Interfaces:**
- Produces: `window.__STEALTH_BOOTSTRAP__` with service name, design flags, accent, and public asset URLs.
- Consumes: `readPublicBootstrap()` during React lazy initial state.

- [ ] Add failing HTML assertions for bootstrap JSON, inline accent, and absence of data-image payloads.
- [ ] Inject safely escaped bootstrap JSON and critical CSS before the first paint.
- [ ] Initialize cabinet design and Stealth layout from bootstrap, then revalidate using the cached web config.
- [ ] Build backend/frontend and confirm HTML assertions pass.

### Task 4: Request deduplication and subscription prefetch

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/pages/cabinet/stealth/stealth-layout.tsx`
- Modify: `frontend/src/pages/cabinet/stealth/stealth-subscribe.tsx`

**Interfaces:**
- Produces: cached `api.getPublicConfig()` and `api.getPublicSubscriptionPageConfig()` with one in-flight request and 30-second TTL.
- Consumes: cached subscription config from the subscribe route.

- [ ] Add source assertions for in-flight deduplication, prefetch, and loading-state guard.
- [ ] Implement retry-safe caches that clear rejected promises.
- [ ] Prefetch subscription config in `StealthLayout`.
- [ ] Render `Loading preview` while config is unresolved and only render the empty warning after loading ends.
- [ ] Build frontend and run regression checks.

### Task 5: Node action menu stacking

**Files:**
- Modify: `frontend/src/pages/remna-nodes.tsx`

**Interfaces:**
- Consumes: `menuFor` and current node UUID.
- Produces: an elevated outer card stacking context only for the open menu.

- [ ] Confirm the source assertion fails without an active-card z-index.
- [ ] Add `relative` and conditional elevated z-index to the outer `motion.div`.
- [ ] Build frontend and confirm the source assertion passes.

### Task 6: Deploy and verify

**Files:**
- Modify only generated Docker images and the shared frontend dist volume.

**Interfaces:**
- Consumes: successful backend/frontend builds.
- Produces: healthy `api`, `bot`, `broadcast-worker`, and `nginx` services serving the optimized build.

- [ ] Build affected Docker images without touching PostgreSQL data.
- [ ] Recreate only services required by the changed images/configuration.
- [ ] Wait on service health instead of fixed delays.
- [ ] Run live regression checks and record payload/timing improvements.
- [ ] Verify the bot still receives `logoBot` from the default config endpoint.
- [ ] Commit only files changed for this task, excluding pre-existing user changes.

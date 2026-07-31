# Admin CPU Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate persistent idle work in `/admin/*` and load route-specific code only when its route is opened.

**Architecture:** Keep the existing React Router structure. Stop the global canvas on admin routes, remove persistent notification polling, and convert page imports to `React.lazy` behind one `Suspense` boundary.

**Tech Stack:** React 18, React Router 6, Vite 5, TypeScript.

## Global Constraints

- Preserve existing user changes and all page behavior except background notification polling/toasts.
- Add no dependencies or new abstraction layers.
- Keep the referral graph active only while `/admin/referral-network` is mounted and the document is visible.

---

### Task 1: Stop persistent admin rendering

**Files:**
- Modify: `frontend/src/components/animated-background.tsx`
- Modify: `frontend/src/components/layout/dashboard-layout.tsx`

- [ ] Verify the current `/admin/login` DOM contains one canvas.
- [ ] Move the admin-route check after hooks, skip the animation effect for every pathname beginning with `/admin`, and include the route/variant in effect dependencies.
- [ ] Remove persistent `animate-ping` and `animate-pulse` classes from the admin layout.
- [ ] Verify `/admin/login` contains zero canvases and the console has no hook errors.

### Task 2: Remove background polling

**Files:**
- Modify: `frontend/src/components/layout/dashboard-layout.tsx`
- Modify: `frontend/src/components/inbox-bell.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] Remove the 15-second notification/toast polling effect from `DashboardLayout`.
- [ ] Replace `InboxBell`'s 60-second timer with one fetch when the Inbox opens; retain its manual refresh button.
- [ ] Fetch public title/favicon configuration once per app load instead of after every route transition.
- [ ] Verify neither persistent admin component contains `setInterval`.

### Task 3: Route-level code splitting

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] Record the baseline production chunks: main `2,641.56 kB`, Recharts `609.42 kB`, referral page `9.06 kB`, force graph `113.01 kB`.
- [ ] Convert route page imports to `React.lazy` named imports and place one `Suspense` boundary around routes.
- [ ] Keep `referral-network`, force graph, analytics, maps, and charts out of the initial route bundle.
- [ ] Run `npm run build`; require TypeScript and Vite exit code 0 and compare chunk sizes.

### Task 4: Rendered verification

**Files:** none

- [ ] Load `/admin/login`; verify page identity, meaningful DOM, zero framework overlays, zero relevant console warnings/errors, and zero canvas elements.
- [ ] Verify the login interaction remains enabled and capture the final viewport.
- [ ] Inspect the final diff to ensure unrelated dirty-worktree files were not changed.

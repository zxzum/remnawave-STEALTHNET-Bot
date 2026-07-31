# Background Admin Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop canvas rendering and periodic admin requests while a browser tab is hidden, then restore them when it becomes visible.

**Architecture:** A tiny React hook exposes the browser visibility state. The referral graph is absent from the DOM while hidden, releasing its canvas and D3 simulation. Client-status and broadcast-status polling check the same state before issuing a request; a visibility event triggers an immediate refresh after the tab becomes visible.

**Tech Stack:** React 18, TypeScript, Vite, Node built-in `assert`.

## Global Constraints

- Add no dependency.
- Preserve all foreground behavior and do not cancel an active broadcast job.
- Use the native `visibilitychange` event.

---

### Task 1: Page-visibility hook

**Files:**
- Create: `frontend/src/hooks/use-page-visibility.ts`
- Create: `frontend/scripts/test-page-visibility.mjs`

**Interfaces:**
- Produces: `usePageVisibility(): boolean`; `true` only while `document.visibilityState === "visible"`.

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import { isPageVisible } from "../.tmp-tests/use-page-visibility.js";

assert.equal(isPageVisible("visible"), true);
assert.equal(isPageVisible("hidden"), false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rm -rf .tmp-tests && npx tsc --module NodeNext --moduleResolution NodeNext --target ES2022 --outDir .tmp-tests src/hooks/use-page-visibility.ts && node scripts/test-page-visibility.mjs`

Expected: FAIL because the hook module does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export const isPageVisible = (visibilityState: DocumentVisibilityState) => visibilityState === "visible";

export function usePageVisibility() {
  const [visible, setVisible] = useState(() => isPageVisible(document.visibilityState));
  useEffect(() => {
    const onChange = () => setVisible(isPageVisible(document.visibilityState));
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rm -rf .tmp-tests && npx tsc --module NodeNext --moduleResolution NodeNext --target ES2022 --outDir .tmp-tests src/hooks/use-page-visibility.ts && node scripts/test-page-visibility.mjs`

Expected: PASS.

### Task 2: Pause visual and network work

**Files:**
- Modify: `frontend/src/pages/referral-network.tsx`
- Modify: `frontend/src/pages/clients.tsx`
- Modify: `frontend/src/pages/broadcast.tsx`

**Interfaces:**
- Consumes: `usePageVisibility(): boolean`.

- [ ] **Step 1: Render only a lightweight placeholder while hidden**

```tsx
const pageVisible = usePageVisibility();
// ...
{pageVisible && <ForceGraph2D /* existing props */ />}
```

- [ ] **Step 2: Guard recurring requests and immediately resume them on visibility**

```ts
if (document.visibilityState !== "visible") return;
```

Use the existing effect cleanup for intervals/timeouts and subscribe to `visibilitychange` only for an immediate foreground refresh.

- [ ] **Step 3: Build the frontend**

Run: `npm run build`

Expected: exit code 0.

### Task 3: Rendered verification

**Files:**
- No source changes.

- [ ] **Step 1: Load `/admin/referral-network` in Chrome**

Verify the visible page has its graph canvas.

- [ ] **Step 2: Hide and restore the document state**

Verify the graph canvas disappears while hidden and returns on visibility; verify no console errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-page-visibility.ts frontend/scripts/test-page-visibility.mjs frontend/src/pages/referral-network.tsx frontend/src/pages/clients.tsx frontend/src/pages/broadcast.tsx docs/superpowers/plans/2026-07-15-background-admin-work-plan.md
git commit -m "perf: pause admin work in background tabs"
```

# Cabinet UX Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated responsive, interactive UX/UI prototype for the client cabinet with demo subscription, payment, and connection flows.

**Architecture:** A small static frontend in `frontend/ux-prototype/` keeps all state local and imports neither production APIs nor routes. Pure helpers supply the contextual CTA and tariff total; browser code renders and updates three views.

**Tech Stack:** HTML, CSS, browser JavaScript modules, Node built-in test runner, existing Vite binary.

## Global Constraints

- Create only files under `frontend/ux-prototype/`; do not modify production cabinet files.
- Use clear demo data only; no network calls, production keys, payments, or persistence.
- Offer mobile bottom navigation and desktop rail navigation for `Кабинет`, `Подключение`, and `Тарифы`.
- Respect `prefers-reduced-motion`; add no dependencies.

---

### Task 1: Model contextual actions and tariff totals

**Files:**

- Create: `frontend/ux-prototype/model.mjs`
- Create: `frontend/ux-prototype/model.test.mjs`

**Interfaces:**

- Produces `getContextAction(subscription) -> { label, view }`.
- Produces `getTariffTotal({ months, extraDevice, extraTraffic }) -> number`.

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { getContextAction, getTariffTotal } from "./model.mjs";

test("sends active unconfigured subscriptions to connection", () => {
  assert.deepEqual(getContextAction({ active: true, daysLeft: 18, connectedDevices: 0 }), { label: "Подключить устройство", view: "connect" });
});
test("sends expiring subscriptions to tariffs", () => {
  assert.deepEqual(getContextAction({ active: true, daysLeft: 3, connectedDevices: 1 }), { label: "Продлить подписку", view: "tariffs" });
});
test("adds selected extras to tariff total", () => {
  assert.equal(getTariffTotal({ months: 12, extraDevice: true, extraTraffic: true }), 2199);
});
```

- [ ] **Step 2: Run the failing test**

Run: `node --test frontend/ux-prototype/model.test.mjs`

Expected: FAIL because `model.mjs` does not exist.

- [ ] **Step 3: Implement the minimal helpers**

```js
export function getContextAction(subscription) {
  if (!subscription.active || subscription.daysLeft <= 0) return { label: "Выбрать тариф", view: "tariffs" };
  if (subscription.connectedDevices === 0) return { label: "Подключить устройство", view: "connect" };
  if (subscription.daysLeft <= 7) return { label: "Продлить подписку", view: "tariffs" };
  return { label: "Открыть ключ", view: "connect" };
}
export function getTariffTotal({ months, extraDevice, extraTraffic }) {
  return ({ 1: 199, 3: 499, 6: 959, 12: 1799 })[months] + (extraDevice ? 250 : 0) + (extraTraffic ? 150 : 0);
}
```

- [ ] **Step 4: Run the passing test**

Run: `node --test frontend/ux-prototype/model.test.mjs`

Expected: PASS with three passing tests.

- [ ] **Step 5: Commit**

Run: `git add frontend/ux-prototype/model.mjs frontend/ux-prototype/model.test.mjs && git commit -m "feat: add UX prototype decision model"`

### Task 2: Render all three prototype views

**Files:**

- Create: `frontend/ux-prototype/index.html`
- Create: `frontend/ux-prototype/app.mjs`
- Create: `frontend/ux-prototype/styles.css`
- Modify: `frontend/ux-prototype/model.test.mjs`

**Interfaces:**

- Consumes `getContextAction` and `getTariffTotal` from `./model.mjs`.
- Produces locally interactive `cabinet`, `connect`, and `tariffs` views.

- [ ] **Step 1: Write the failing browser-surface check**

```js
import { readFile } from "node:fs/promises";
test("contains all primary views and reduced-motion guard", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("./index.html", import.meta.url), "utf8"),
    readFile(new URL("./styles.css", import.meta.url), "utf8"),
  ]);
  for (const view of ["cabinet", "connect", "tariffs"]) assert.match(html, new RegExp(`data-view="${view}"`));
  assert.match(css, /prefers-reduced-motion/);
});
```

- [ ] **Step 2: Run the failing check**

Run: `node --test frontend/ux-prototype/model.test.mjs`

Expected: FAIL because the HTML and CSS do not exist.

- [ ] **Step 3: Implement the isolated frontend**

Create an HTML shell with `data-view="cabinet"`, `data-view="connect"`, and `data-view="tariffs"` templates, a desktop rail, a mobile bottom navigation, and an `#app` render target. Implement these exact interactions in `app.mjs`:

1. Cabinet: animated days, traffic progress, subscription switcher, auto-renew switch, and CTA from `getContextAction`.
2. Connection: subscription selector, masked demo key, copy feedback, platform selector, and four setup steps.
3. Tariffs: clickable flipping balance card, duration selection, extra-device and extra-traffic controls, balance/card/SBP/crypto choice, and local success confirmation.

Create CSS for the dark blue-violet visual system, mobile/desktop breakpoints at `768px`, fade-up screen entry, periodic CTA shimmer, number and progress transitions, and a reduced-motion override.

- [ ] **Step 4: Run the passing check**

Run: `node --test frontend/ux-prototype/model.test.mjs`

Expected: PASS with four passing tests.

- [ ] **Step 5: Commit**

Run: `git add frontend/ux-prototype && git commit -m "feat: add responsive cabinet UX prototype"`

### Task 3: Verify the primary journey at two viewport sizes

**Files:**

- Modify only `frontend/ux-prototype/app.mjs` or `frontend/ux-prototype/styles.css` if browser testing finds a defect.

- [ ] **Step 1: Run unit checks**

Run: `node --test frontend/ux-prototype/model.test.mjs`

Expected: PASS with four passing tests.

- [ ] **Step 2: Start the local prototype**

Run: `frontend/node_modules/.bin/vite --host 127.0.0.1 --port 4174 --root frontend/ux-prototype`

Expected: Vite reports `http://127.0.0.1:4174/`.

- [ ] **Step 3: Verify mobile and desktop**

At 390px and 1440px wide, check: cabinet CTA opens connection; copying changes feedback; balance card flips; add-ons update total; a payment option shows confirmation; mobile uses bottom navigation; desktop uses the rail; no horizontal overflow.

- [ ] **Step 4: Capture and inspect screenshots**

Capture one mobile and one desktop screenshot. Repair clipped content, weak contrast, unwanted wrapping, and navigation overlap before handoff.

- [ ] **Step 5: Commit final fixes**

Run: `git add frontend/ux-prototype && git commit -m "test: verify cabinet UX prototype"`

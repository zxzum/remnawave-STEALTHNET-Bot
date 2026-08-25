# Tariff Description Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve line breaks, blank lines, and repeated spaces from tariff descriptions on the Lazeyka VPN landing page and in the client cabinet.

**Architecture:** Keep tariff descriptions as unchanged strings while mapping public API responses. Render those strings directly and use native CSS `white-space: pre-wrap` so whitespace is preserved without disabling safe wrapping of long lines.

**Tech Stack:** TypeScript, React 18, Tailwind CSS 4, scoped CSS, Node.js test runner.

## Global Constraints

- Do not change the API, database, or tariff administration form.
- Preserve every character in a non-empty tariff description.
- Keep the existing tariff-group emoji before the cabinet description.
- Add no dependencies or new abstractions.

---

### Task 1: Preserve descriptions in frontend mapping

**Files:**
- Modify: `frontend/scripts/lazeyka-landing.test.mjs`
- Modify: `frontend/src/cabinet/model.test.mjs`
- Modify: `frontend/src/pages/lazeyka-landing-model.ts:31-45`
- Modify: `frontend/src/cabinet/model.ts:112-127,332-363`

**Interfaces:**
- Consumes: `PublicTariffCategory[].tariffs[].description: string | null | undefined`
- Produces: `LandingTariff.description: string` and `TariffPlan.emojiLine: string`

- [ ] **Step 1: Write failing mapping tests**

Change the landing fixture description and expectation to the same exact string:

```js
const description = "  Выбор большинства  \n\n  50GB белых списков  ";
// ...fixture: description
assert.equal(result[0].description, description);
```

Add a cabinet mapping test:

```js
test("preserves tariff description whitespace for cabinet rendering", () => {
  const description = "  Выбор большинства  \n\n  50GB белых списков  ";
  const [group] = mapTariffGroups([{ id: "g1", name: "VPN", emoji: "⭐", tariffs: [{
    id: "t1", name: "Стандарт", description, durationDays: 30, price: 200,
    currency: "rub", deviceLimit: 5, includedDevices: 5,
    pricePerExtraDevice: 0, maxExtraDevices: 0, deviceDiscountTiers: [], priceOptions: [],
  }] }]);
  assert.equal(group.plans[0].emojiLine, `⭐\n${description}`);
});
```

- [ ] **Step 2: Run tests and verify the regression fails**

Run:

```bash
cd frontend
node --experimental-strip-types --test scripts/lazeyka-landing.test.mjs src/cabinet/model.test.mjs
```

Expected: failures show that landing trims the string and cabinet splits it into an array.

- [ ] **Step 3: Implement minimal mapping changes**

In `lazeyka-landing-model.ts`, preserve any non-empty description:

```ts
description: tariff.description || "Защищённый доступ без лишних настроек",
```

In `cabinet/model.ts`, change `TariffPlan.emojiLine` to `string` and preserve the description:

```ts
emojiLine: [group.emoji, tariff.description].filter((value): value is string => Boolean(value)).join("\n"),
```

- [ ] **Step 4: Run mapping tests and verify they pass**

Run the Step 2 command. Expected: all selected tests pass.

### Task 2: Render preserved whitespace

**Files:**
- Modify: `frontend/src/pages/lazeyka-landing.css:4`
- Modify: `frontend/src/cabinet/pages/Tariffs.tsx:303-309,734-735`

**Interfaces:**
- Consumes: unchanged `LandingTariff.description` and `TariffPlan.emojiLine` strings from Task 1.
- Produces: rendered descriptions using CSS `white-space: pre-wrap`.

- [ ] **Step 1: Apply native whitespace rendering**

Add `white-space:pre-wrap` to `.plan__pick>small` and `.plain-plan span` in `lazeyka-landing.css`. In both cabinet description elements, render `{plan.emojiLine}` directly and add Tailwind's `whitespace-pre-wrap` class.

- [ ] **Step 2: Run focused tests and the production build**

Run:

```bash
cd frontend
node --experimental-strip-types --test scripts/lazeyka-landing.test.mjs src/cabinet/model.test.mjs
npm run build
```

Expected: tests and build exit with status 0.

- [ ] **Step 3: Validate the rendered flow in Browser**

The flow under test is: landing tariff card and `/cabinet/tariffs` -> description containing line breaks, a blank line, and repeated spaces -> the same whitespace is visible without overflow.

Start the existing Vite app, then verify page identity, meaningful DOM, no framework overlay, console health, desktop and mobile screenshots, and the tariff-card interaction. Do not commit screenshots or temporary browser data.

- [ ] **Step 4: Commit the implementation**

```bash
git add frontend/scripts/lazeyka-landing.test.mjs frontend/src/cabinet/model.test.mjs frontend/src/pages/lazeyka-landing-model.ts frontend/src/pages/lazeyka-landing.css frontend/src/cabinet/model.ts frontend/src/cabinet/pages/Tariffs.tsx
git commit -m "fix: preserve tariff description formatting"
```

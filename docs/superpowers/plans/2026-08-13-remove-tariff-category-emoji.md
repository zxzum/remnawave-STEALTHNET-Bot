# Remove Tariff Category Emoji Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop rendering the tariff category emoji as part of every tariff card description.

**Architecture:** Change only the existing `mapTariffGroups` mapping. Preserve the tariff description verbatim and leave category, backend, admin, and bot data untouched.

**Tech Stack:** TypeScript, Node.js built-in test runner, React/Vite frontend.

## Global Constraints

- Product name remains Лазейка ВПН.
- Do not alter category emoji storage or any bot/admin behavior.
- Add no dependencies or abstractions.

---

### Task 1: Remove Category Emoji From Card Description

**Files:**
- Modify: `frontend/src/cabinet/model.test.mjs`
- Modify: `frontend/src/cabinet/model.ts`

**Interfaces:**
- Consumes: existing public tariff group data.
- Produces: `TariffPlan.emojiLine` containing only `tariff.description` or an empty string.

- [x] **Step 1: Update the regression test first**

Rename the existing description test and replace its expectation:

```js
test("keeps category emoji out of tariff card descriptions", () => {
  const description = "  Выбор большинства  \n\n  50GB белых списков  ";
  const [group] = mapTariffGroups([{ id: "g1", name: "VPN", emoji: "⭐", tariffs: [{
    id: "t1", name: "Стандарт", description, durationDays: 30, price: 200,
    currency: "rub", deviceLimit: 5, includedDevices: 5,
    pricePerExtraDevice: 0, maxExtraDevices: 0, deviceDiscountTiers: [], priceOptions: [],
  }] }]);

  assert.equal(group.plans[0].emojiLine, description);
});
```

- [x] **Step 2: Verify RED**

Run: `node --test src/cabinet/model.test.mjs`

Expected: FAIL because the current value starts with `⭐`.

- [x] **Step 3: Implement the one-line mapping fix**

```ts
emojiLine: tariff.description ?? "",
```

- [x] **Step 4: Verify GREEN and build**

Run: `node --test src/cabinet/model.test.mjs && npm run build`

Expected: 14 tests pass and the frontend build exits with code 0.

- [x] **Step 5: Commit**

```bash
git add frontend/src/cabinet/model.test.mjs frontend/src/cabinet/model.ts docs/superpowers/plans/2026-08-13-remove-tariff-category-emoji.md
git commit -m "fix: remove category emoji from tariff cards"
```

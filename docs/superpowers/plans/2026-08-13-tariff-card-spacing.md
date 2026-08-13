# Tariff Card Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Уменьшить расстояние от многострочного описания тарифа до цены и гарантировать зазор перед кнопкой выбора.

**Architecture:** Добавить два локальных CSS-переопределения внутри существующего `@scope (.lazeyka-landing)`. Разметка, данные, размеры карточек и логика выбора тарифа не меняются.

**Tech Stack:** React, scoped CSS, Vite, Node test runner, Browser visual QA.

## Global Constraints

- Расстояние от описания до цены: ровно `24px`.
- Расстояние от характеристик до кнопки: не менее `16px`.
- Сохранить переносы строк, HTML, данные тарифов и выравнивание CTA.
- Не добавлять зависимости.

---

### Task 1: Исправить вертикальный ритм карточек

**Files:**
- Modify: `frontend/src/pages/lazeyka-landing.css`
- Test: production/browser geometry plus existing frontend tests

**Interfaces:**
- Consumes: существующие классы `.plan`, `.price`, `.plan__pick`, `.plan > .button`.
- Produces: CSS-геометрию `24px` после описания и минимум `16px` перед CTA.

- [ ] **Step 1: Зафиксировать воспроизведение**

На `https://bot.lazeika.xyz/#tariffs` измерить `getBoundingClientRect()` для `.plan__pick > small`, `.price`, `.plan dl` и `.plan > .button`.

Expected before fix: `descriptionToPrice === 40` and `detailsToButton === 0`.

- [ ] **Step 2: Внести минимальную CSS-правку**

Добавить рядом с существующим правилом сохранения переносов строк:

```css
.price{margin-top:24px}.plan dl{margin-bottom:16px}
```

Первое свойство задаёт точный интервал от описания до цены. Второе гарантирует `16px` между характеристиками и CTA, а существующий `margin-top: auto` у кнопки продолжает выравнивать её по низу карточки при наличии свободного пространства.

- [ ] **Step 3: Проверить CSS и frontend**

Run:

```bash
cd frontend
node --experimental-strip-types --test scripts/*.test.mjs src/cabinet/*.test.mjs
npm run build
```

Expected: все тесты проходят, Vite build завершается без ошибок.

- [ ] **Step 4: Проверить desktop и mobile в браузере**

На desktop и mobile повторить геометрические измерения и визуальную проверку.

Expected after fix:

```text
descriptionToPrice = 24
detailsToButton >= 16
horizontalOverflow = false
consoleErrors = 0
```

Нажать кнопку выбора другого тарифа и убедиться, что выбранная карточка меняется.

- [ ] **Step 5: Закоммитить правку**

```bash
git add frontend/src/pages/lazeyka-landing.css
git commit -m "fix: balance tariff card spacing"
```

# Public Subscription Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать существующий объединённый subscription URL полноценной страницей подключения в браузере без изменения поведения VPN-клиентов.

**Architecture:** `publicSubscriptionRouter` выбирает HTML только для настоящей браузерной навигации. Новый небольшой renderer формирует самодостаточную страницу из логической Subscription, Remnawave-квот и сохранённого `subscription_page_config`.

**Tech Stack:** TypeScript, Express, Node test runner, HTML/CSS/vanilla JS.

## Global Constraints

- URL остаётся `/api/sub/:publicSubscriptionToken`.
- Страница всегда использует обычную тему STEALTHNET.
- Не добавлять зависимости, новый сервис или новый публичный endpoint.
- VPN-клиенты сохраняют текущую объединённую выдачу и Main fallback.
- Приложения берутся из `system_settings.subscription_page_config`.

---

### Task 1: Content negotiation и HTML renderer

**Files:**
- Create: `backend/src/modules/subscription/public-subscription-page.ts`
- Create: `backend/src/modules/subscription/public-subscription-page.test.ts`
- Modify: `backend/src/modules/subscription/composite-subscription.routes.ts`

**Interfaces:**
- Produces: `isBrowserSubscriptionRequest(userAgent: string, accept: string): boolean`.
- Produces: `renderPublicSubscriptionPage(model: PublicSubscriptionPageModel): string`.
- Consumes: `componentQuotaFromRemna`, `getSubscriptionByPublicToken`, `resolveRemnawaveComponents`, `remnaGetUser`.

- [ ] **Step 1: Write failing tests**

Test that Mozilla + `text/html` selects HTML, Happ remains client output, dangerous links and HTML are escaped, placeholders receive the public URL, and configured Happ/INCY/all-app entries render.

- [ ] **Step 2: Verify RED**

Run: `npm test --prefix backend -- public-subscription-page.test.ts`

Expected: FAIL because the renderer module does not exist.

- [ ] **Step 3: Implement the minimal renderer**

Create one dependency-free renderer with private `escapeHtml`, `safeHref`, locale selection, byte/date formatting and config traversal helpers. Use native `<details>` for instructions and one inline clipboard handler; emit no external assets.

- [ ] **Step 4: Branch in the existing route**

Before fetching subscription bodies, fetch component users in parallel for browser requests, derive visible quotas with `componentQuotaFromRemna`, read `subscription_page_config`, render HTML, and return `Cache-Control: private, no-store`. Leave the current VPN-client branch unchanged.

- [ ] **Step 5: Verify GREEN**

Run: `npm test --prefix backend -- public-subscription-page.test.ts`

Expected: all public page tests pass.

### Task 2: Regression and browser verification

**Files:**
- Modify only Task 1 files if verification finds a defect.

- [ ] **Step 1: Run backend regression tests**

Run: `npm test --prefix backend`

Expected: zero failures, including composite subscription client detection and merging.

- [ ] **Step 2: Build backend**

Run: `npm run build --prefix backend`

Expected: TypeScript exits 0.

- [ ] **Step 3: Verify production-like responses locally**

Request the same token with browser, Happ, V2RayTun, Koala and unknown client headers. Assert browser `Content-Type: text/html`, no `/assets/` references, and unchanged component counts/formats for clients.

- [ ] **Step 4: Deploy without overwriting server-owned files**

Fast-forward the existing server checkout, rebuild only API and worker, then wait for API healthcheck.

- [ ] **Step 5: Browser QA**

Open the real URL at desktop and mobile widths. Verify subscription cards, Happ/INCY, configured app list, copy action, responsive layout, zero console errors and zero missing assets.


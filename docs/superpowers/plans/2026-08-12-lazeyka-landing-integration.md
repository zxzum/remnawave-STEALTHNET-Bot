# Lazeyka Landing Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the root landing page with the supplied Lazeyka design while keeping public configuration, tariffs, FAQ, UTM attribution, cabinet routes, and production deployment connected to the existing application.

**Architecture:** Keep the current React/Vite application and root route. Replace only `LandingPage`, add its isolated stylesheet and four optimized artwork files, and adapt existing `PublicConfig`, `fetchLanding`, and `api.getPublicTariffs()` responses into the supplied layout with local fallback content.

**Tech Stack:** React 18, TypeScript 5.6, React Router 6, Vite 5, Node test runner, Docker Compose, nginx.

## Global Constraints

- Product copy and UI name are **Лазейка ВПН**.
- Existing `stealthnet` technical identifiers remain unchanged.
- Do not add dependencies or backend/database changes.
- Preserve all unrelated local and production working-tree changes.
- Deploy only the frontend bundle to `https://bot.lazeika.xyz` after creating source and volume backups.

---

### Task 1: Landing contract and backend adapter

**Files:**
- Create: `frontend/scripts/lazeyka-landing.contract.test.mjs`
- Modify: `frontend/src/pages/landing.tsx`

**Interfaces:**
- Consumes: `LandingPage({ config: PublicConfig })`, `fetchLanding(lang): Promise<LandingApiResponse>`, `api.getPublicTariffs(): Promise<{ items: PublicTariffCategory[] }>`, `useUtmCaptureAndBuildLink(): (path: string) => string`.
- Produces: a root landing page that renders immediately from fallbacks, then replaces tariffs and editable copy with public API values when available.

- [ ] **Step 1: Write the failing source contract**

Create a Node test that reads `frontend/src/pages/landing.tsx` and asserts the integration points before any implementation exists:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const page = readFileSync(resolve(root, "frontend/src/pages/landing.tsx"), "utf8");

test("new landing keeps backend and cabinet contracts", () => {
  assert.match(page, /fetchLanding/);
  assert.match(page, /api\.getPublicTariffs\(\)/);
  assert.match(page, /useUtmCaptureAndBuildLink/);
  assert.match(page, /config\.supportLink/);
  assert.match(page, /config\.telegramBotUsername/);
  assert.match(page, /\/cabinet\/login/);
  assert.match(page, /\/cabinet\/register/);
});

test("new landing retains its visual and accessibility contract", () => {
  for (const id of ["benefits", "route", "tariffs", "faq"]) assert.match(page, new RegExp(`id=["']${id}["']`));
  for (const asset of ["hero-world.jpg", "route-world.jpg", "devices-world.jpg", "cta-portal.jpg"]) assert.match(page, new RegExp(asset));
  assert.match(page, /aria-expanded/);
  assert.match(page, /aria-pressed/);
});
```

- [ ] **Step 2: Run the contract and verify it fails**

Run: `node --test frontend/scripts/lazeyka-landing.contract.test.mjs`

Expected: FAIL because the current block-renderer landing has no supplied artwork or direct tariff adapter.

- [ ] **Step 3: Implement the minimal adapter inside `LandingPage`**

Replace the existing block renderer with the supplied component structure. Reuse the existing hooks and API client:

```tsx
const FALLBACK_TARIFFS = [
  { id: "standard", name: "Стандарт", price: 200, trafficGb: 50, devices: 5 },
  { id: "optimal", name: "Оптимальный", price: 300, trafficGb: 100, devices: 5, popular: true },
  { id: "premium", name: "Премиум", price: 400, trafficGb: 150, devices: 5 },
];

const [landing, setLanding] = useState<LandingApiResponse | null>(null);
const [tariffs, setTariffs] = useState(FALLBACK_TARIFFS);
const buildLink = useUtmCaptureAndBuildLink();

useEffect(() => {
  fetchLanding(config.defaultLanguage ?? "ru").then(setLanding).catch(() => undefined);
  api.getPublicTariffs().then(({ items }) => {
    const live = items.flatMap((category) => category.tariffs).map((tariff) => ({
      id: tariff.id,
      name: tariff.name,
      price: tariff.price,
      trafficGb: tariff.trafficLimitBytes ? Math.round(Number(tariff.trafficLimitBytes) / 1024 ** 3) : null,
      devices: tariff.includedDevices || tariff.deviceLimit || 1,
      popular: tariff.name === "Оптимальный",
    }));
    if (live.length) setTariffs(live);
  }).catch(() => undefined);
}, [config.defaultLanguage]);
```

Use the published FAQ block when it contains an `items` array, otherwise use the supplied fallback FAQ. Use `config.logo`, `config.serviceName`, `config.supportLink`, and a normalized Telegram URL derived from `config.telegramBotUsername`. Build the existing `/cabinet/register` and `/cabinet/login` links with UTM; tariff buttons enter the existing registration and tariff-selection flow.

- [ ] **Step 4: Run the contract and TypeScript build**

Run: `node --test frontend/scripts/lazeyka-landing.contract.test.mjs`

Expected: PASS.

Run: `npm --prefix frontend run build`

Expected: PASS with a generated `frontend/dist/index.html` and hashed assets.

- [ ] **Step 5: Commit the adapter**

```bash
git add frontend/scripts/lazeyka-landing.contract.test.mjs frontend/src/pages/landing.tsx
git commit -m "feat: connect Lazeyka landing to public APIs"
```

---

### Task 2: Supplied visual system and artwork

**Files:**
- Create: `frontend/src/pages/lazeyka-landing.css`
- Create: `frontend/src/assets/lazeyka-landing/brand-mark-small.png`
- Create: `frontend/src/assets/lazeyka-landing/hero-world.jpg`
- Create: `frontend/src/assets/lazeyka-landing/route-world.jpg`
- Create: `frontend/src/assets/lazeyka-landing/devices-world.jpg`
- Create: `frontend/src/assets/lazeyka-landing/cta-portal.jpg`
- Modify: `frontend/src/pages/landing.tsx`
- Modify: `frontend/scripts/lazeyka-landing.contract.test.mjs`

**Interfaces:**
- Consumes: class names and image imports from the supplied `/Users/sallyqx/Documents/projects/lazeika_landing/src/App.jsx` and `src/styles.css`.
- Produces: isolated `.lazeyka-landing` styles that do not alter cabinet/admin pages and preserve the supplied responsive layout.

- [ ] **Step 1: Extend the failing visual contract**

Read the new stylesheet in the contract and assert isolation, responsive behavior, and reduced motion:

```js
const css = readFileSync(resolve(root, "frontend/src/pages/lazeyka-landing.css"), "utf8");

test("landing CSS stays isolated and responsive", () => {
  assert.match(css, /\.lazeyka-landing/);
  assert.match(css, /@media\(max-width:680px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /:focus-visible/);
});
```

- [ ] **Step 2: Run the visual contract and verify it fails**

Run: `node --test frontend/scripts/lazeyka-landing.contract.test.mjs`

Expected: FAIL because the stylesheet and copied artwork do not exist yet.

- [ ] **Step 3: Copy only the optimized supplied assets**

```bash
mkdir -p frontend/src/assets/lazeyka-landing
cp /Users/sallyqx/Documents/projects/lazeika_landing/assets/brand-mark-small.png frontend/src/assets/lazeyka-landing/
cp /Users/sallyqx/Documents/projects/lazeika_landing/assets/{hero-world,route-world,devices-world,cta-portal}.jpg frontend/src/assets/lazeyka-landing/
```

Import these five files from `landing.tsx`; do not copy the unused PNG variants.

- [ ] **Step 4: Port and isolate the supplied stylesheet**

Copy the supplied CSS rules into `lazeyka-landing.css`, scope root selectors and component classes beneath `.lazeyka-landing`, and import it only from `landing.tsx`:

```tsx
import "./lazeyka-landing.css";
```

Set the root element rendered by `LandingPage` to the following opening tag and keep every supplied section inside it:

```tsx
<div className="lazeyka-landing" id="top">
```

Keep the existing `prefers-reduced-motion`, mobile menu, focus-visible, breakpoint, artwork masking, and layout rules. Do not change global theme or cabinet styles.

- [ ] **Step 5: Run contracts and production build**

Run: `node --test frontend/scripts/lazeyka-landing.contract.test.mjs`

Expected: PASS.

Run: `npm --prefix frontend run build`

Expected: PASS.

- [ ] **Step 6: Perform browser QA**

Run the local Vite server and inspect `/` at 1440×900 and 390×844. Verify the header, mobile menu, API tariffs, FAQ accordion, register/login links, Telegram links, `/offer`, `/privacy`, and browser console. Compare the result with the supplied landing and fix only observable regressions.

- [ ] **Step 7: Commit the visual integration**

```bash
git add frontend/src/pages/landing.tsx frontend/src/pages/lazeyka-landing.css frontend/src/assets/lazeyka-landing frontend/scripts/lazeyka-landing.contract.test.mjs
git commit -m "feat: adopt Lazeyka landing design"
```

---

### Task 3: Safe frontend-only production deployment

**Files:**
- Deploy: the Task 1–2 frontend files to `/opt/remnawave-STEALTHNET-Bot/frontend/` on host `bot`.
- Backup: `/opt/backups/lazeyka-landing-pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).tar.gz` and the current `stealthnet_frontend_dist` volume.

**Interfaces:**
- Consumes: the existing remote Docker Compose `frontend` one-shot builder and shared `frontend_dist` volume.
- Produces: `https://bot.lazeika.xyz/` serving the new bundle without resetting the dirty production worktree or restarting backend services.

- [ ] **Step 1: Re-run local release checks**

Run: `node --test frontend/scripts/lazeyka-landing.contract.test.mjs && npm --prefix frontend run build`

Expected: all tests and build PASS.

- [ ] **Step 2: Record production state and create targeted backups**

Use `git -c safe.directory=/opt/remnawave-STEALTHNET-Bot status --short` to record existing dirty files. Archive the current landing source, stylesheet/assets if present, and the named frontend volume under `/opt/backups` before copying anything.

- [ ] **Step 3: Upload only the landing-owned files**

Use `rsync -a` for:

```text
frontend/src/pages/landing.tsx
frontend/src/pages/lazeyka-landing.css
frontend/src/assets/lazeyka-landing/
frontend/scripts/lazeyka-landing.contract.test.mjs
```

Do not run `git reset`, `git clean`, or the full repository deploy script because production has unrelated working-tree changes.

- [ ] **Step 4: Build and publish only the frontend bundle**

On `bot`, run the contract test, `docker compose build frontend`, and `docker compose up --no-deps frontend`. Leave `api`, `bot`, `postgres`, and workers running.

- [ ] **Step 5: Smoke-test production**

Verify HTTP 200 for `/`, `/cabinet/login`, `/cabinet/register`, `/offer`, `/privacy`, `/api/public/config`, `/api/public/tariffs`, and `/api/public/landing?lang=ru`. Confirm the returned root HTML references the new hashed bundle and inspect the live page at desktop and mobile sizes with no console errors.

- [ ] **Step 6: Confirm preservation**

Compare the remote dirty-file list with Step 2. Expected: all pre-existing changes remain, plus only the four uploaded landing paths. Record the backup paths and the successful production timestamp.

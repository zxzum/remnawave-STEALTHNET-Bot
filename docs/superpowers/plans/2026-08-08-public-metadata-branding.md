# Public Metadata Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all public page metadata identify the product as «Лазейка ВПН» without exposing Remnawave or STEALTHNET.

**Architecture:** Keep the existing SSR branding flow and static Vite/PWA metadata. Change only their user-visible brand and description values; preserve configured `serviceName` overrides and all legacy technical identifiers.

**Tech Stack:** Node.js 22, TypeScript, `node:test` via `tsx`, Vite, `vite-plugin-pwa`.

## Global Constraints

- Public fallback brand is `Лазейка ВПН`.
- Public descriptions use `${brand} — личный кабинет и админка VPN`.
- Public metadata must not contain `Remnawave` or `STEALTHNET`, case-insensitively.
- Keep `serviceName` overrides from system settings.
- Do not rename compatibility paths, Docker services, env variables, database fields, or internal identifiers containing `stealthnet`.
- Do not add dependencies or change unrelated user-facing copy.

---

### Task 1: Remove legacy names from public metadata

**Files:**
- Create: `backend/src/modules/branding/spa-html-metadata.contract.test.ts`
- Modify: `backend/src/modules/branding/spa-html.ts:21-22,79-82`
- Modify: `frontend/index.html:7`
- Modify: `frontend/vite.config.js:23`

**Interfaces:**
- Consumes: the existing SSR constants `DEFAULT_BRAND`, `DEFAULT_DESC`, and dynamic `description` in `resolveBrand()`; the static HTML description; the PWA manifest description.
- Produces: public metadata whose fallback and generated descriptions use «Лазейка ВПН» and contain neither legacy name.

- [ ] **Step 1: Write the failing regression test**

Create `backend/src/modules/branding/spa-html-metadata.contract.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const spaUrl = new URL("./spa-html.ts", import.meta.url);
const indexUrl = new URL("../../../../frontend/index.html", import.meta.url);
const viteUrl = new URL("../../../../frontend/vite.config.js", import.meta.url);

test("public metadata uses Lazeyka branding without legacy platform names", async () => {
  const [spa, index, vite] = await Promise.all([
    readFile(spaUrl, "utf8"),
    readFile(indexUrl, "utf8"),
    readFile(viteUrl, "utf8"),
  ]);

  assert.equal(spa.match(/const DEFAULT_BRAND = "([^"]+)"/)?.[1], "Лазейка ВПН");
  assert.equal(
    spa.match(/const DEFAULT_DESC = "([^"]+)"/)?.[1],
    "Лазейка ВПН — личный кабинет и админка VPN",
  );
  assert.equal(
    spa.match(/: `(\$\{brand\}[^`]+)`/)?.[1],
    "${brand} — личный кабинет и админка VPN",
  );
  assert.equal(
    index.match(/<meta name="description" content="([^"]+)"/)?.[1],
    "Лазейка ВПН — личный кабинет и админка VPN",
  );
  assert.match(vite, /description: "Лазейка ВПН — личный кабинет и админка VPN"/);

  const publicMetadata = [
    spa.match(/const DEFAULT_BRAND = "([^"]+)"/)?.[1],
    spa.match(/const DEFAULT_DESC = "([^"]+)"/)?.[1],
    spa.match(/: `(\$\{brand\}[^`]+)`/)?.[1],
    index.match(/<meta name="description" content="([^"]+)"/)?.[1],
    ...[...vite.matchAll(/description:\s*"([^"]+)"/g)].map((match) => match[1]),
  ].filter((value): value is string => Boolean(value));

  assert.doesNotMatch(publicMetadata.join("\n"), /remnawave|stealthnet/i);
});
```

- [ ] **Step 2: Run the new test and verify the failure is correct**

Run from `backend/`:

```bash
rtk npm exec -- tsx --test src/modules/branding/spa-html-metadata.contract.test.ts
```

Expected: **FAIL** on the first assertion because the current fallback brand is `STEALTHNET`; the failure must be an assertion failure, not a missing-file, import, or syntax error.

- [ ] **Step 3: Apply the minimal metadata changes**

In `backend/src/modules/branding/spa-html.ts`, set:

```ts
const DEFAULT_BRAND = "Лазейка ВПН";
const DEFAULT_DESC = "Лазейка ВПН — личный кабинет и админка VPN";
```

In `resolveBrand()`, replace the dynamic description with:

```ts
const description = brand === DEFAULT_BRAND ? DEFAULT_DESC : `${brand} — личный кабинет и админка VPN`;
```

In `frontend/index.html`, set the description meta content to:

```html
Лазейка ВПН — личный кабинет и админка VPN
```

In `frontend/vite.config.js`, set the PWA manifest `description` to the same text.

- [ ] **Step 4: Run the regression test and verify it passes**

Run from `backend/`:

```bash
rtk npm exec -- tsx --test src/modules/branding/spa-html-metadata.contract.test.ts
```

Expected: **PASS** with zero failures.

- [ ] **Step 5: Run the complete backend test suite**

Run from `backend/`:

```bash
rtk npm test
```

Expected: the command exits with status 0 and reports no failed tests.

- [ ] **Step 6: Build both runtime surfaces**

Run:

```bash
rtk npm run build
```

from `backend/`, then run the same command from `frontend/`.

Expected: both TypeScript/backend and Vite/PWA builds exit with status 0.

- [ ] **Step 7: Review the diff and commit the implementation**

Run from the repository root:

```bash
rtk git add backend/src/modules/branding/spa-html.ts frontend/index.html frontend/vite.config.js backend/src/modules/branding/spa-html-metadata.contract.test.ts
rtk git diff --cached --check
rtk git diff --cached -- backend/src/modules/branding/spa-html.ts frontend/index.html frontend/vite.config.js backend/src/modules/branding/spa-html-metadata.contract.test.ts
rtk git commit -m "fix: remove legacy branding from public metadata"
```

Expected: the diff contains only the metadata changes and their regression test; the commit succeeds.

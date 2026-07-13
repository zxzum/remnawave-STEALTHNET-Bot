# Cabinet Loading Performance Design

## Goal

Make the admin node action menu render above all node cards and make the Stealth cabinet reach a correct first paint almost immediately, with no red accent flash or false “applications are not configured” state. Normal loading may show a neutral `Loading preview`; target completion is under 1–2 seconds on the current server.

## Root causes

- Every node card is a transformed `motion.div`, which creates a stacking context. The menu's `z-50` cannot escape that context, so later cards paint above it.
- `:root` hard-codes the red Stealth accent and React replaces it only after `/api/public/config` resolves.
- `/api/public/config` is about 6.85 MB because `logo` and `logoBot` each contain a 3.38 MB data URL.
- The SSR SPA HTML embeds the logo data URL twice in OG/Twitter tags, making every cabinet document about 6.77 MB.
- Many React components independently request the same public config. There is no in-flight or TTL deduplication.
- The subscribe page interprets `pageConfig === null` during loading as a real empty application list.

## Design

1. Raise the active node card's outer stacking context while its menu is open. This keeps the current positioning and interaction behavior while allowing the menu to paint above sibling cards.
2. Add cacheable public image endpoints for the web logo, favicon, and Stealth hero. The lightweight web config returns versioned URLs for data-backed images and omits the bot-only logo payload; the existing bot config remains compatible.
3. Change SSR branding to use the versioned logo URL instead of embedding base64. Inject a small synchronous bootstrap object and inline `--stealth-accent` style into `<head>` so the correct design, brand, and accent exist before CSS/React paint.
4. Deduplicate public config and subscription-page requests in the frontend with an in-flight promise and a 30-second value cache. Prefetch the subscription page from `StealthLayout` while the dashboard is visible.
5. Render `Loading preview` while the subscription config is unresolved. Show “applications are not configured” only after a successful completed fetch returns no apps.

## Error handling

- If the lightweight config request fails, keep the server bootstrap values and allow later calls to retry; rejected promises are never cached.
- If subscription config fails, end loading and show the existing empty/error fallback only after the request completes.
- Public asset routes return 404 for missing values and preserve configured external HTTP(S) URLs without proxying them.

## Verification

- Before/after live size and timing measurements for `/cabinet/dashboard`, `/api/public/config?target=web`, and `/api/public/subscription-page`.
- TypeScript builds for backend and frontend.
- Source regression checks for the active card z-index and loading guard.
- Container health checks and live JSON/HTML assertions after deployment.
- Rollback artifacts, image tags, source archive, frontend dist archive, and database dump remain under `/opt/backups/vpn-load-speed-20260713-105158`.

# Floating chat support CTA

## Goal

Make the mobile floating chat control visible without covering the bottom navigation, keep it visually consistent with Лазейка ВПН, and expose a clear Telegram support action in both chat modes.

## Existing flow

- `FloatingChat` already contains the AI assistant and ticket list/detail/create flows.
- The public API already returns the administrator-configured `support_link` as `supportLink`; the frontend type does not currently declare it.
- The profile support card currently derives a URL from the login bot username, which can point to the wrong Telegram bot.

## Decision

1. Add one reusable Telegram CTA row to the shared chat header so it appears in both `AI-чат` and `Тикеты`, including ticket detail and creation states.
2. Use `config.supportLink` from the database-backed public configuration. Fall back to `https://t.me/lazeika_support_bot` when the value is empty or unavailable.
3. Point the profile support card at the same resolved URL.
4. On mobile, move the floating chat button upward enough to clear the bottom navigation. Preserve the desktop position.
5. Restyle the floating button with the cabinet’s purple/blue glass treatment, stronger contrast, and two soft expanding rings. Respect `prefers-reduced-motion`.

## Interaction and visual behavior

- The CTA is a full-width, high-contrast link with a Telegram icon, `Написать в Telegram` label, and external-link affordance.
- It opens the resolved URL in a new tab/window with `noopener noreferrer`.
- The floating button remains 56px on mobile and 64px on larger screens, with a visible glow and a low-frequency wave animation only when it is closed.
- Opening the chat hides the closed-state wave; existing AI, ticket, unread-count, attachment, and polling behavior remains unchanged.

## Implementation scope

- `frontend/src/components/floating-chat.tsx`: CTA, mobile FAB offset, cabinet styling, wave rings.
- `frontend/src/cabinet/pages/Profile.tsx`: use the database-backed support URL with fallback.
- `frontend/src/lib/api.ts`: declare `supportLink` on `PublicConfig`.
- `frontend/scripts/profile-navigation.test.mjs` or a focused chat test: assert the URL source, CTA presence in both modes, and mobile positioning classes.

No backend schema or API change is required because `support_link` is already stored and returned by the public config endpoint.

## Verification

- Run the focused static/UI test.
- Build the frontend.
- Check the rendered profile and floating chat at mobile and desktop widths.
- Verify the CTA href resolves to the configured support URL and falls back to the canonical support bot URL.

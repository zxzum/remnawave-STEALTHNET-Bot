# Floating Chat Visual Refinement Design

**Date:** 2026-08-12

**Status:** Approved by the user

## Goal

Make the floating chat feel like part of the Лазейка ВПН cabinet instead of a nearly black overlay, while keeping Telegram support visible in both AI and support/ticket modes without a large standalone CTA card.

## Design

### 1. Lighter cabinet glass surface

- Replace the near-black chat panel surface with a layered violet/blue glass gradient.
- Keep the existing blur, rounded desktop shell, full-screen mobile behavior, and shadow hierarchy.
- Add a restrained radial highlight in the message area so the background remains readable without competing with messages.
- Keep existing AI/support message logic, ticket flows, input behavior, unread polling, and attachments unchanged.

### 2. Compact Telegram action pill

- Keep `TelegramSupportCta` in the shared `ChatHeader`; it therefore remains available in AI and support/ticket modes.
- Keep the configured `supportUrl` and exact Telegram fallback unchanged.
- Remove the secondary description and oversized icon tile.
- Render one compact horizontal pill with a small Telegram icon, the existing “Написать в Telegram” label, and the external-link arrow.
- Use a subtle blue-to-violet accent, enough contrast for the existing dark/violet cabinet, and an accessible link label.

## Scope and constraints

- Modify only `frontend/src/components/floating-chat.tsx` and its focused static regression test.
- Do not add dependencies, backend routes, database fields, or new chat state.
- Preserve `target="_blank"`, `rel="noopener noreferrer"`, and reduced-motion behavior already present in the chat.
- Keep the CTA data-driven from `config.supportLink`.

## Verification

- Extend the focused test to assert the compact CTA classes and retained Telegram label/link behavior.
- Run the focused frontend regression test and the frontend production build.
- Perform desktop and mobile authenticated browser QA when a signed-in browser session is available; otherwise report the auth limitation explicitly.

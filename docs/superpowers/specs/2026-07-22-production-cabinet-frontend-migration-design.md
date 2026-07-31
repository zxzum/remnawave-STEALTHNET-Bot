# Production Cabinet Frontend Migration

## Goal

Replace the Classic and Stealth client interfaces with the approved `cabinet-prototype` design for browser, mobile, and Telegram Mini App. Keep the administration panel and backend behavior intact, connect every client action to production APIs, archive both old designs, and ship one client interface with no runtime fallback.

## Scope

The migration covers client login, registration, verification, password recovery, onboarding, cabinet, access keys, tariffs, referrals, profile, payments, Telegram linking, and every client feature enabled by server configuration. The administration panel remains unchanged except that the obsolete Classic/Stealth design selector is removed.

The following optional client features remain available when enabled by public configuration:

- custom tariff builder;
- extra options;
- Proxy;
- Sing-box;
- gifts;
- support through the existing floating chat and ticket backend.

## Architecture

Keep the existing production frontend application, React 18 runtime, router, authentication providers, API client, localization, branding bootstrap, PWA setup, administration panel, and deployment structure. Port the approved prototype components into the existing client route tree and adapt the prototype data layer to the production client context and API methods.

Do not replace or upgrade the whole frontend project. The prototype's JSX, CSS, component hierarchy, responsive behavior, payment presentation, and route transition animation are the visual source of truth. Functional wiring may change component handlers, state sources, validation states, loading states, and conditional visibility without visually redesigning existing components.

## Routing and Transitions

Preserve existing production URLs so links from the bot, email, payment providers, and bookmarks continue to work:

- `/cabinet/dashboard` — cabinet;
- `/cabinet/subscribe` — access keys and setup;
- `/cabinet/tariffs` — tariffs and checkout;
- `/cabinet/referral` — referrals;
- `/cabinet/profile` — profile, balance, security, and history;
- all existing authentication, verification, onboarding, payment-return, and optional-feature routes.

Load the client pages together rather than splitting them into lazy route chunks. Preserve the prototype's `useOutlet` and `AnimatePresence mode="wait"` page transition, including its fade/vertical motion, duration, easing, and mobile behavior. Switching between client pages must not display a loading placeholder. Existing admin lazy loading remains unchanged.

Skeletons are allowed only while initial production data is unresolved, and they must match the new visual system.

## Data and Authentication

Replace prototype mock state with production data while retaining the component-facing shape needed to avoid visual rewrites. Reuse `ClientAuthProvider`, token refresh, Telegram Mini App auto-authentication, and the existing API client.

The client flows include:

- email/password login and 2FA challenge;
- Telegram browser login and Telegram Mini App authentication;
- email or Telegram registration;
- email verification and link-email verification;
- password recovery and reset;
- onboarding, password setup, and optional authenticator 2FA;
- logout and expired-token handling.

The UI must derive user, balance, subscriptions, tariff, device, referral, and transaction state from backend responses. Mutations refresh only the affected state and expose pending and error feedback through the existing prototype controls and toast system.

## Telegram Linking

After email registration, offer the approved `BindTelegramDialog`. The dialog uses the existing `clientLinkTelegramRequest` and `clientLinkTelegram` flows instead of a prototype toast. Choosing “Later” closes the prompt without blocking cabinet access.

If the account still has no linked Telegram identity, expose the same action from Profile so the user can link it later. Do not duplicate the linking protocol or create a new backend endpoint.

## Tariffs and Payments

Preserve the prototype tariff configurator and checkout presentation, especially the highlighted Platega block. Duration, selected extra devices, target subscription, extension/conversion intent, promo code, and removal/retention of existing extras map to the current production payloads.

The browser never authoritatively calculates entitlement or price. It displays backend tariff data and sends identifiers and selections; the backend validates availability, price, currency, promo, target subscription, and final entitlement.

Payment actions map as follows:

- orange balance button → `clientPayByBalance`;
- Platega СБП/card/crypto buttons → `clientCreatePlategaPayment` with the enabled server-provided method ID;
- Crypto Bot → `cryptopayCreatePayment`, preferring the Telegram Mini App URL in Telegram and the web URL in a browser;
- balance top-up → the configured production provider APIs;
- external payment completion → the existing `/cabinet/payment-wait` status flow.

Only server-enabled payment providers appear. Disable the initiating control while a payment request is pending and preserve the existing payment-result and retry handling. Do not expose provider credentials or trust client-supplied amounts.

## Core and Optional Features

Connect the approved Cabinet, Keys, Tariffs, Referrals, and Profile components to all relevant existing operations, including multiple subscriptions, renewal, conversion, auto-renewal, copying and opening subscription links, device deletion, balance top-up, payment history, password changes, email linking, 2FA, promo codes, withdrawals, and referral sharing.

Add screens in the same visual system for production features absent from the prototype: custom builder, extra options, Proxy, Sing-box, and gifts. Keep the five approved primary destinations unchanged. Expose optional screens through a compact overflow entry only when at least one corresponding public feature flag is enabled.

Keep the existing floating support chat and its ticket, reply, attachment, unread-count, and AI-support behavior available in the new client shell.

## Administration and Configuration

Do not redesign, restructure, or upgrade the administration panel. Remove only the Classic/Stealth selector and its browser-application switch because the new design is unconditional.

Remove runtime consumption of `cabinetDesign` and `cabinetDesignApplyInBrowser` from the client, public bootstrap, public web configuration, and frontend types. Stop writing those values from the admin settings form. Existing database rows remain untouched for recoverability but have no runtime effect.

## Archival and Backup

Before production changes, create a timestamped local backup containing:

- a Git bundle with all reachable branches, tags, and commits;
- a working-tree snapshot containing tracked, untracked, ignored configuration, and current uncommitted changes;
- SHA-256 checksums;
- a short restoration guide.

Exclude reproducible dependencies, build output, and caches such as `node_modules`, `dist`, and tool caches. Protect any configuration-bearing backup files with owner-only permissions and do not commit them.

Archive Classic and Stealth separately outside `frontend/src`, with a manifest and checksum for each. The archives must contain the source and design-specific assets needed for inspection or restoration. They must not be imported, copied into the Vite build graph, or used as a fallback.

## Performance

Preserve instant client navigation by eagerly including the client screens and keeping the approved page transitions. Improve initial loading without route-level client lazy loading:

- remove Classic, Stealth, and prototype mock data from the runtime graph;
- retain the existing lightweight branding bootstrap and cached public web configuration;
- deduplicate shared config/profile/subscription requests;
- fetch independent initial resources in parallel;
- avoid refetching unchanged data on client route transitions;
- defer non-critical optional-feature data until its screen or control is opened;
- render only initial data skeletons, never inter-page skeletons.

Compare the production build and cold-load request trace before and after migration. The new client must not regress initial transferred JavaScript or duplicate public-config requests relative to the pre-migration build.

## Error Handling and Security

- Keep authenticated requests behind the existing token refresh and authorization flow.
- Treat backend feature flags and validation responses as authoritative.
- Validate email, passwords, 2FA codes, numeric top-up values, files, and payment selections at their existing trust boundaries.
- Prevent repeated mutation submissions while a request is pending.
- Preserve server-side payment idempotency and webhook verification; do not implement payment completion in browser state.
- Show errors in the relevant prototype surface or toast without falling back to an archived design.
- Preserve accessible labels, keyboard interaction, focus handling, reduced-motion behavior, safe-area padding, and minimum touch targets.

## Verification

Verification must include:

- frontend and backend typecheck/build;
- focused tests for adapter mapping, payment payloads and provider selection, authentication state, feature-flag navigation, and Telegram-link visibility;
- browser login, registration, verification, recovery, 2FA, logout, and Telegram Mini App authentication;
- all five primary screens and every enabled optional screen;
- balance, Platega, Crypto Bot, promo, extension/conversion, extra-device, and payment-return flows without executing an unintended real charge;
- desktop, phone, and Telegram Mini App-sized viewports;
- exact preservation of the prototype's page transition and Platega presentation;
- skeleton, empty, error, pending, and success states;
- confirmation that Classic, Stealth, and mock data are absent from the Vite runtime graph;
- build-size and network-request comparison against the pre-migration baseline;
- checksum validation and a dry-run listing of all backup and design archives.

## Acceptance Criteria

- The new approved frontend is the only client design in browser and Telegram Mini App.
- The administration panel is unchanged except for removal of the obsolete design selector.
- Existing components from `cabinet-prototype`, including the Platega payment block and page transitions, retain their approved appearance and behavior.
- Every existing client capability is either available in the five primary screens, the support widget, or a feature-flagged optional screen.
- No archived design is present in the production runtime or used as a fallback.
- Authentication and payment authority remain on the backend.
- Initial loading does not regress against the recorded pre-migration baseline, and client page switching remains immediate.
- The pre-migration project and both old designs can be independently restored from validated archives.

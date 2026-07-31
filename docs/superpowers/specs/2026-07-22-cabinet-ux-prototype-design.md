# Cabinet UX prototype

## Purpose

Create a standalone, interactive visual prototype of the client cabinet. It must preserve STEALTHNET product logic while making the primary path obvious: enter, choose or renew a tariff, then connect a device.

The prototype is isolated from the production cabinet, its APIs, authentication, payment providers, and subscription keys.

## Information architecture

There are three primary destinations on both desktop and mobile:

1. **Кабинет** — subscription health and the single next action.
2. **Подключение** — access-key copy and the device setup path.
3. **Тарифы** — balance, tariff selection, add-ons, and payment-method choice.

Profile and support remain secondary actions. On desktop they sit below the primary navigation; on mobile they are reachable from a compact user menu rather than competing with the purchase and connection flow.

## Screens and demo behaviour

### Cabinet

- Show the selected subscription's active status, animated remaining-days counter, monthly traffic progress, device usage, renewal date, and auto-renew switch.
- Allow compact switching between multiple subscriptions.
- Use one contextual CTA: connect a device for an active but unconfigured subscription; renew when close to expiry; select a tariff when no active subscription exists.
- The primary CTA receives a brief shimmer periodically rather than looping continuously.

### Connection

- Select the subscription first if more than one is present.
- Copy a masked demo access link.
- Select platform and app, then expose four concise connection steps.
- The screen preserves the current product's guided installation concept, without exposing a production key.

### Tariffs

- Show the account balance on a clickable virtual card with a flip state; the back contains safe demo account details and a balance top-up action.
- Display tariff duration options, current/recommended state, per-month price, discount, optional extra devices, and optional extra traffic.
- Allow selection of a payment method: balance, bank card, SBP, or crypto. A demo confirmation updates local UI state only.
- When an existing subscription is selected, make auto-renew visible and explain that it uses the selected payment method or balance according to configuration.

## Responsive model

- **Mobile (< 768px):** one-column canvas and fixed bottom navigation with the three primary destinations.
- **Tablet/Desktop (>= 768px):** left navigation rail, a central content column, and a contextual right-side summary panel when space permits. Controls retain the same order and labels as mobile.
- No horizontal scrolling; touch targets stay at least 44px high.

## Visual system and motion

- Use the existing dark STEALTHNET mood: near-black canvas, restrained blue-violet accents, clear white typography, and high contrast controls.
- Borrow the competitor's hierarchy—not its branding: large numerical status, quiet rounded containers, clear selected pricing, and visible single actions.
- Screens enter with a small upward fade. The days counter and traffic bar animate on initial load. The virtual card flips on click. Motion is disabled for `prefers-reduced-motion`.

## Technical boundaries

- Place the prototype in a new isolated folder under `frontend/`.
- Use existing React, Tailwind, Framer Motion, and Lucide dependencies; add none.
- Keep all data as clearly labelled demo data in the prototype. No production routes, API calls, persistence, or secrets.
- Provide lightweight local interaction checks appropriate for a prototype, then verify build and mobile/desktop rendering.

## Acceptance criteria

- A reviewer can complete the demo path from cabinet to tariff selection to connection without leaving the three primary destinations.
- The prototype visibly handles multiple subscriptions, auto-renewal, non-balance payments, balance top-up, extra devices, and traffic add-ons.
- The layout works at a phone viewport and a wide desktop viewport.
- The specified motion works and respects reduced-motion preferences.

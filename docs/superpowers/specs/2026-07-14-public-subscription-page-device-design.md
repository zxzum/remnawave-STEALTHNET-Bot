# Public subscription page: device-aware dark layout

## Scope

Improve the existing `GET /api/sub/:publicSubscriptionToken` browser response without adding an endpoint, frontend bundle, dependency, or service.

## Data flow

- Read `serviceName` and `logo` from the existing cached `getSystemConfig()` result. Subscription-page JSON no longer owns public-page branding.
- Reuse the existing subscription-page JSON as the source of supported platforms, applications, and import links.
- Fetch Remnawave users and hosts in parallel. Host failure must not break subscription delivery.
- Render only enabled, visible hosts accessible to at least one Remnawave component after applying `excludedInternalSquads`.

## UI

- Always render the public page in a dark theme.
- Render the configured database logo and service name in the header, with a text fallback when the logo is absent or invalid.
- Add a compact, styled platform selector for iOS, Android, macOS, Windows, and Linux.
- A small inline script detects the browser platform and selects the matching configured platform. The user may switch platforms manually.
- Show only the selected platform's applications.
- Replace detailed application cards with large connection buttons near the top. Render Happ, INCY, and every other application that has a configured subscription import link.
- Keep quota, subscription URL, and status blocks below the connection controls.
- At the bottom, render a collapsed-by-default `details` block containing compact cards for available Remnawave host remarks. Do not expose addresses, UUIDs, or technical fields.

## Compatibility and errors

- VPN client responses and content negotiation remain unchanged.
- An unknown browser platform falls back to the first configured platform and remains manually selectable.
- Invalid logo schemes are not rendered.
- A failed hosts request produces an empty host section without failing the page.
- Existing HTML escaping and URL validation stay in place.

## Tests

- Database branding overrides subscription-page JSON branding.
- Platform sections and import buttons are rendered for client-side selection.
- Dark theme is the default.
- Only eligible active hosts are rendered and the host list is collapsible.
- Existing browser/client negotiation tests remain green.

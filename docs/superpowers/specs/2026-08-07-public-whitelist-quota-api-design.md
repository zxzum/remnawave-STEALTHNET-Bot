# Public Whitelist Quota API Design

## Goal

Show each Лазейка ВПН subscriber's local whitelist quota on the public
subscription page without exposing service credentials or accepting a browser
supplied user identity.

## Scope

- Add `POST /v1/whitelist/quota` to the backend.
- Integrate the request into `/Users/sallyqx/Documents/projects/sub-page-remna`.
- Do not deploy, change PostgreSQL, Redis, nginx, Remnawave, or quota-accounting
  behaviour.

## API contract

```http
POST /v1/whitelist/quota
Authorization: Bearer <subscription-token>
Origin: https://sub.lazeika.xyz
```

Successful responses are private and non-cacheable:

```json
{
  "status": "ready",
  "usedBytes": 9948000000,
  "limitBytes": 53687091200,
  "remainingBytes": 43739000000,
  "percent": 18.57,
  "asOf": "2026-08-07T10:00:00.000Z"
}
```

`status` is one of `ready`, `pending`, `unavailable`, or `not_found`. Only a
`ready` response with finite non-negative byte values and a positive limit is
displayed by the page.

## Backend flow

1. Parse only a bearer subscription token; reject missing or malformed input.
2. Verify that token server-side with the existing Remnawave client using a
   fixed API path. The request contains no `userId`, `shortUuid`, URL, or other
   user identity from the browser.
3. Map the verified Remnawave UUID to the local `Subscription`, then read the
   existing local whitelist quota for that subscription.
4. Normalize bigint values to safe JSON numbers only when representable;
   otherwise return `unavailable`. Compute percent server-side, rounded to two
   decimal places, and set `asOf` from the quota update timestamp.
5. Return generic errors only. Do not log the bearer token, subscription URL,
   verified user payload, or quota data.

The route permits only the production origin. It sets `Vary: Origin,
Authorization` and `Cache-Control: private, no-store`; it accepts only
`POST`, `OPTIONS`, `Authorization`, and `Content-Type`; it sends no credential
cookies. A small in-process fixed-window limiter keys independently by trusted
client IP and verified subscription ID, returns `429` with `Retry-After`, and
does not store secrets. Remnawave verification has a five-second abort timeout.

## Frontend flow

After `panelData` is parsed and the normal page has rendered, the page obtains
the subscription token from the already-rendered subscription URL, calls the
endpoint with an `AbortController` timeout of four seconds, and keeps both the
token and response in component memory only. The request runs from
`requestIdleCallback` when available and otherwise a zero-delay timer.

Until a valid `ready` response arrives, the quota card shows an em dash, muted
bar, and `Данные временно недоступны`. Failed, pending, unavailable, and
not-found results keep that state. There are no automatic retries; a manual
reload is the cooldown. Existing subscription links and template helpers are
not modified.

## Tests

Backend tests cover: missing/malformed/invalid subscription credentials,
Remnawave timeout, CORS allow/deny, rate limiting, ignored browser identity
fields, status mapping, byte/percent normalization, cache headers, and the
absence of credential values in logs.

Frontend tests cover: immediate first render, four-second timeout and fallback,
valid ready rendering, non-ready/error fallback, and no persistence of token or
quota data. Existing subscription URL, `incy://`, `happ://`, HTTPS, and copy
flows remain regression-tested by unchanged helpers.

## Constraints and limitation

The subscription token is a bearer credential and is necessarily available in
the subscription page's input URL. This design avoids persisting or widening
its exposure, but anyone who obtains it can request that subscription's quota,
the same authority required to retrieve the subscription itself.

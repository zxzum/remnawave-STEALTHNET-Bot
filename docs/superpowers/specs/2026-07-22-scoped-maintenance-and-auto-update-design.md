# Scoped Maintenance and Automatic UI Updates

## Goal

Deploy a rebuilt frontend without a manual PWA update action, while showing a temporary maintenance page only for the interface being deployed.

## Scope

- Automatically activate a newly built service worker and reload open UI clients when its update is detected.
- Remove the user-facing PWA update prompt.
- Serve one lightweight animated maintenance document directly from nginx.
- Let deployment select `admin`, `cabinet`, or `all`; admin covers `/admin` and its descendants, cabinet covers `/cabinet` and its descendants.
- Treat changes to shared frontend files as `all`.
- Keep `/api`, the Telegram bot, and public routes available.
- Document the production deployment workflow for future AI operators.

## Design

The PWA changes from prompt activation to automatic activation. Its generated service worker claims clients, and the existing application reloads when the controller changes. This removes the "Apply changes" notification while retaining the PWA cache and hashed static assets.

Nginx checks for one of two short-lived marker files outside the frontend build output. When the relevant marker exists, requests under its route prefix receive a static no-cache maintenance page with a CSS-only animation. Assets for the maintenance page are embedded, so it remains available while the frontend volume is being replaced.

The deployment script accepts an explicit scope. It creates the matching marker before copying/building, waits for the API health check, verifies that the frontend build completed, then removes the marker. A shell trap removes any marker if deployment exits unexpectedly. `all` is the safe default for shared frontend changes.

## Email Registration

Email registration remains verification-based. It requires either SMTP (`host`, `port`, and sender address; credentials when the provider requires them) or Resend (API key and verified sender address), plus the public HTTPS application URL. The deployment guide will include a post-deploy verification registration. The system must not silently enable `skipEmailVerification`.

## Verification

- Test the maintenance-route selection and marker cleanup in the deployment script.
- Build the frontend and verify that the generated service worker is configured for automatic activation.
- Confirm `/admin` is blocked only in `admin` scope and `/cabinet` only in `cabinet` scope.
- Confirm API health remains reachable during maintenance.
- Confirm an email registration sends a verification link and that the link completes registration.

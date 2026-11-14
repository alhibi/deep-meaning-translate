# ADR 0004 — One service-worker registrar and an explicit offline shell

Status: **Accepted** (verified 2026-11-07). Includes a documented preview hazard.

## Context

The app is installable and must open without a connection. `vite-plugin-pwa` generates `sw.js`
with a precache, NetworkFirst document navigation, a precache fallback to `/offline.html` when a
fetch fails, and runtime rules for hashed assets. Registration must not happen in development,
iframes or ephemeral previews.

## Decision

- `src/lib/pwa.ts` is the only registrar. It refuses to register outside production, inside an
  iframe, on Lovable preview hosts, and when the URL carries `?sw=off`; it also unregisters its own
  worker in those cases.
- The worker precaches the shell, uses NetworkFirst for navigations (with no `navigateFallback`
  route), CacheFirst for `/assets/`, and never caches translation requests.
- `scripts/check-pwa.mjs` fails the build if the precache empties.
- `?sw=off` is the supported diagnostic escape hatch for local/preview verification.

## Problem observed during the audit

A production preview registered the worker on an ephemeral preview host. After the server was
switched to a development build, the worker served the **old production shell**, whose hashed
chunks no longer matched the dev server. The next internal navigation raised a route error
boundary. Unregistering the worker and clearing caches removed it; it did not reproduce in 17
navigation cycles or in a fresh production preview with `?sw=off`.

This is a preview/deployment artifact, **not** a product navigation defect. It is recorded because
it can mimic one and because stale-shell behaviour must never be diagnosed from a single run.

## Alternatives considered

- **Register everywhere**: contaminates development and previews, as observed.
- **No service worker**: loses offline opening and installation value.
- **Cache translation responses**: leaks private text into a shared cache and risks stale results.
  Rejected.

## Consequences

- Offline first paint is a branded page, not a browser error, but it is shown only when a
  navigation fetch fails and no document is cached.
- A deploy can briefly serve an older shell until the new worker activates; `skipWaiting` and
  `clientsClaim` keep that window short.
- Tests and preview runs should use `?sw=off` unless the service worker itself is under test.

## Correction (2026-11-14, F15)

The audit found that Workbox's `navigateFallback` route was registered before the NetworkFirst
document route, so **every** navigation was answered from `/offline.html`, online or not. It was
not merely an offline fallback.

Leaving the option unset did not fix it: `vite-plugin-pwa` defaults it to `"index.html"`, which is
not precached, so registration threw and the routes after it were never registered.

The worker now disables the option (`navigateFallback: null`), keeps the NetworkFirst document
route, and attaches `PrecacheFallbackPlugin` so `/offline.html` is used only when a fetch fails and
no document is cached. `tests/e2e/pwa_navigation.py` reproduces the old failure (two online
navigations served the offline page) and passes on the new production build.

## Related

`docs/operations/development-and-release.md`, `docs/quality/navigation-regression.md`,
`vite.config.ts`, `src/lib/pwa.ts`.

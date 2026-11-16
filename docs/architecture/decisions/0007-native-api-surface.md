# ADR 0007 — Versioned native API surface with an origin allowlist

Status: accepted · 2026-11-16

## Context

The packaged app loads its UI from `https://localhost`, so relative `/api/...` calls would
hit the local asset server. It must reach the Worker, which already owns the prompts,
provider keys and rate limits. Two constraints: no secret can live in the APK, and a web
page must not be able to drive the native surface.

## Decision

- Add `/api/native/v1/*` routes that reuse the existing handlers, schemas, throttles and
  prompts. No second implementation.
- Allow exactly the app origins (`https://localhost`, `capacitor://localhost`,
  `http://localhost`, plus `NATIVE_ALLOWED_ORIGINS`), echo only the matched origin, never
  `*`, and refuse requests without an allowed `Origin`. Preflight is explicit.
- Require HTTPS in the client base URL (`VITE_NATIVE_API_BASE`, default
  `https://fluently.today`); cleartext is disabled at the Android network-security layer.
- Keep all provider keys server-side. Abuse control stays per-purpose rate limiting, not a
  shared secret in the APK.

## Consequences

- The app and the website exercise the same engine; a behaviour fix lands once.
- A leaked APK yields no provider credential.
- Adding a new endpoint means adding a native route that wraps the same handler, so the
  surface stays small and reviewable.
- Development against `http://10.0.2.2` is the only cleartext allowance and is compiled
  out of release builds.

# ADR 0001 — One document, one client-rendered shell

Status: **Accepted** (verified 2026-11-07).

## Context

The product is one focused screen with a small number of secondary routes. It must feel like a
single continuous application, survive navigation, and avoid full-page reloads. The stack is
TanStack Start with route-level code splitting and SSR.

## Problem

A multi-document architecture (full navigation per route) would reset providers, replay boot work
and flash the canvas. A fully static SPA without SSR would delay first content and make the
first-run introduction cover a painted translator.

## Decision

Render one server document shell (root route) and navigate internally with the router. Keep the
root shell, theme, locale and providers mounted. Server-render the shell and the first-run
introduction; lazy-load only sheets that are closed on first paint.

## Alternatives considered

- **Multi-page app**: simpler caching, unacceptable continuity and first-paint cost.
- **Client-only SPA**: no SSR, worse first content and SEO for public pages.
- **Keep every route mounted**: memory and lifecycle complexity; not needed for two screens.

## Consequences

- Route components unmount; continuity must be restored explicitly (session + remembered values).
- Boot work must run before hydration via inline scripts, not effects.
- View transitions are available as progressive enhancement.
- Documentation must state which state is route-local and which survives.

## Related

ADR 0002 (restore pair), ADR 0003 (palette before paint),
`docs/architecture/navigation-and-lifecycle.md`.

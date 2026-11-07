# ADR 0003 — The document owns the palette before paint

Status: **Accepted** (verified 2026-11-07).

## Context

Three themes (dark clay, light paper, vivid electric) are selected before hydration by
`THEME_BOOT`. The root document previously had a transparent background while `body` carried the
theme colour. Route transitions cross-fade two snapshots; during most of a cross-fade both
snapshots are partially transparent.

## Problem

With a transparent root and no backdrop on the view-transition overlay, the browser's canvas could
show through mid-transition. Combined with asymmetric snapshot durations (180 ms out, 260 ms in),
this produced a perceptible colour shift — the "app changes colour for a moment" report.

The browser-chrome `theme-color` was also only updated by `ThemeToggle`, which `/stats` does not
mount, so a light visit could keep the server's dark chrome colour.

## Decision

1. `html` owns an explicit `background-color: var(--color-background)` and a stable scrollbar
   gutter.
2. The `::view-transition` overlay carries `var(--background)`.
3. Both snapshots use `mix-blend-mode: normal` and the same 220 ms duration/easing.
4. `syncThemeColor()` reads the computed `--background` and updates every `theme-color` meta; the
   root route calls it once after mount and `apply()` calls it on every theme change. An empty
   computed value (jsdom) is ignored, never written.

## Alternatives considered

- **Disable view transitions**: removes continuity and does not fix the underlying transparent
  canvas.
- **Paint a full-screen overlay during navigation**: hides the defect and adds a fake layer.
- **Set the colour only in `body`**: body background propagation is not reliable once the root has
  a background; the document must own it.

## Consequences

- No sampled frame during navigation shows a colour other than the theme background.
- The browser chrome follows the theme on every route, including `/stats`.
- The transition is a true cross-fade rather than one page lingering over the other.

## Related

ADR 0001, `docs/design/motion-and-accessibility.md`, `src/styles.css`, `src/lib/theme.ts`.

# Motion and Accessibility

Status: **Verified** by source inspection, unit tests and browser frame sampling on 2026-11-07.
Reduced-motion behavior was inspected in CSS, not tested on a physical device.

## Motion principles

1. Motion explains a change of place or state; it never decorates idle UI.
2. Navigation is a **cross-fade**, not a rebuild: the outgoing page lets go while the incoming page
   arrives.
3. A theme change is a **reveal from the control**, a different movement that must not fight the
   route cross-fade.
4. Durations are short and consistent (220 ms for the route cross-fade), with the product's easing
   tokens. No layout-triggering animation.
5. `prefers-reduced-motion` removes or shortens movement; the interface remains fully usable.
6. No animation may cover a blank frame, a data refetch or a remount.

## Navigation transition

In `src/styles.css`:

- `::view-transition` carries the theme background, so the cross-fade never reveals the browser
  canvas.
- Old and new snapshots both use `mix-blend-mode: normal` and the same 220 ms duration/easing.
- `html.theme-reveal` suppresses the default root fade for exactly the lifetime of a theme reveal
  (set by `theme.ts`), while the clip-path reveal runs from the touched control.
- The document owns its background and a stable scrollbar gutter.

These are progressive enhancements: browsers without view transitions still navigate normally.

## Feedback (`feel`)

Haptics and synthesised tones go through one façade (`src/lib/feel/`). Call sites name what happened
(`feel.confirm()`, `feel.arrive()`), not how to render it. Settings are read at call time, so a
toggle applies to the next action without a re-render. There are no audio files; a single
`AudioContext` is created lazily inside a user gesture. Reduced-motion or silent settings can turn
the whole layer off.

## Accessibility rules

- **Focus**: every sheet traps focus, wraps Tab, closes on Escape and returns focus to its opener.
  The focus ring is solid `--ring`, never a tint; it is gated at 3:1.
- **Labels**: icon-only controls have real accessible names in the active interface language.
- **Semantics**: one `main` landmark per surface, headings in order, dialogs with `role="dialog"`
  and `aria-modal`, live regions only where a status change must be announced.
- **Contrast**: text 4.5:1, focus 3:1, verified by `check:contrast` across all themes.
- **Text scaling**: relative sizing and wrapping are used; long translations and long source text
  are part of the layout, not an afterthought.
- **RTL**: `dir` is set on the document before paint; Arabic copy uses the Arabic face; focus order
  follows the DOM, not the visual direction.
- **Touch**: controls meet a 44 px target where they are touch actions; safe areas are respected.
- **Motion**: reduced-motion is honored; no essential information is conveyed only by animation.

## Verified evidence

- Contrast: **51/51 pairs** pass (`npm run check:contrast`).
- Focus ring: included in the gate as a solid 3:1 pair.
- Dialog focus behavior: unit-tested (`useFocusTrap` tests) and used by every sheet.
- Navigation background: all sampled frames showed one background colour; see
  `docs/architecture/navigation-and-lifecycle.md`.
- Screen-reader announcement quality and real-device reduced-motion behavior: **NOT_VERIFIED** in
  this environment.

## Adding motion

1. Name the purpose (continuity, feedback or spatial relationship). If it is decoration, do not add
   it.
2. Use an existing token; do not invent a duration or easing.
3. Respect reduced motion.
4. Animate transform/opacity/clip-path, not layout.
5. Add it to the navigation test if it affects route transitions, and verify that it cannot expose a
   background or blank frame.

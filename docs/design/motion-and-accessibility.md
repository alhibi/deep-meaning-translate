# Motion and Accessibility

Status: **Verified** by source inspection, unit tests, browser frame sampling and Chromium
reduced-motion emulation on 2026-11-16; editing geometry rechecked on 2026-11-17. Physical-device frame pacing is still **NOT_VERIFIED**.

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
7. The signature exception is **arrival**: a streamed translation's new words whip in on the
   "whirlwind" (blur, a warm signal trail, a short skew/spin) and a quiet signal caret shows the
   answer is still being written. This is the one deliberate, repeated flourish; it must stay
   paint-only (no width or letter-spacing animation), animate only the fresh tail (≤28 words per
   render), and drop to a fade under reduced motion. Provider deltas are coalesced to one React
   commit per animation frame so the text can arrive without spending a frame per chunk.
8. The statistics **practice map** is a mount-only composition: nodes grow from the centre and the
   ribbons draw once, staggered by rank. It has no continuous loop and no keyframes in
   `styles.css`; reduced motion renders the same map without the transition.

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
- Streaming smoothness: 390×844 headless Chromium, 2026-11-16 — 60 fps and zero long tasks
  unthrottled; 6× CPU throttle averaged ~44 fps with 10–13 long tasks ≤73 ms. Disabling the arrival
  effect produced the same long-task count (React + text layout dominate, not the blur); the
  composer held one 122.4 px height and the result never overlapped it.
- Reduced motion: emulated in Chromium; the `word-in` animations resolve to a fade and the caret is
  static. Screen-reader announcement quality and real-device reduced-motion behavior:
  **NOT_VERIFIED** in this environment.
- Editing follow-up, 2026-11-17: Chromium 153, 15 viewport/locale/theme combinations; no source/result
  overlap or URL overflow, a common 120 px three-line composer, two full lines under simulated
  keyboard opening, no forced scroll of the active field, and no font-size change on stream settle.
  `field_layout.py` passed 23 checks and `composer_interactions.py` passed 44. These are geometry and
  interaction observations, **not** a new physical-device frame-rate measurement.

## Adding motion

1. Name the purpose (continuity, feedback or spatial relationship). If it is decoration, do not add
   it.
2. Use an existing token; do not invent a duration or easing.
3. Respect reduced motion.
4. Animate transform/opacity/clip-path, not layout.
5. Add it to the navigation test if it affects route transitions, and verify that it cannot expose a
   background or blank frame.

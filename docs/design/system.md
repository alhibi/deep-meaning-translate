# Design System

Status: **Verified** against `src/styles.css`, components and the contrast gate on 2026-11-17.
Visual regression was not automated; no screenshot claim is made beyond the checks listed.

## Philosophy

Calm, precise, editorial. The translation is the loudest element; chrome is quiet. No gradients,
glassmorphism, decorative AI imagery, giant rounded containers or generic dashboard patterns. Motion
communicates continuity and state, never decoration.

## Themes

Three, and only three: **dark clay**, **light paper**, **vivid electric** (a dark palette). The theme
name is the class on `<html>`, so there is no mapping table between CSS and TypeScript. A new theme
is a CSS block plus an entry in `THEMES`; the contrast gate fails until every required pair clears
its ratio.

Selection is validated centrally, restored before paint, and migrated from legacy names. System
preference supplies the default when nothing is stored.

## Tokens

Semantic roles, not raw colours, are used by components:

- surfaces and text: `--background`, `--foreground`, `--muted-foreground`, `--faint`;
- actions: `--signal`, `--signal-foreground`, `--primary`, `--primary-foreground`;
- structure: `--border`, `--border-strong`, `--ring`;
- motion: `--ease-soft`, `--ease-out`.

Values live in `src/styles.css` and are the single source of truth. `scripts/check-contrast.mjs`
reads the real tokens, follows `var()` indirection, composites translucent values over their
surface, and gates text at 4.5:1 and the focus indicator at 3:1. Hairline borders are reported, not
gated, because no border is the sole affordance.

At the audit close: **51 pairs pass**.

## The translation's arrival

The answer is the loudest element, and its arrival is the one signature flourish. Streamed words
condense out of a soft blur with a faint warm signal trail, skewed and spun, then snap clear; a
single quiet caret shows generation is still in flight and disappears when the answer settles. The
animation is paint-only, scoped to the fresh tail of a live stream, and reduced to a fade for
`prefers-reduced-motion`. Settled answers keep no promoted layers. The full rule and its measured
cost live in `docs/design/motion-and-accessibility.md`.

## Reading behind the words

The dictionary and the sentence shadow are reading surfaces, not more translation. The dictionary
sheet leads with the in-context reading for the sentence that was written and puts the model-source
line on the surface; forms, synonyms, collocations, nuances and example pairs stay behind one
disclosure, so a word lookup does not become a page or a card grid. The shadow is drawn as a
relationship: the translation carries a quiet offset echo over the parts that may have lost meaning,
a one-line summary beneath it says how many findings there are or that nothing essential was lost,
and the map shows both texts in full with the same numbered marks — side by side on a wide screen,
stacked in reading order on a phone — where a mark reveals its counterpart. Strength and confidence
are separate measures, never merged into one score. These surfaces reuse the existing fade/sheet
motion, and the map scrolls a counterpart into view instantly under `prefers-reduced-motion`.

## Translation Statistics: the practice map

The statistics page is a private, editorial reading of the local archive, not a dashboard. Its
"خريطة ممارستك" panel is a real map: the strongest domain is the centre, the other domains orbit it
at sizes and ribbon widths derived from frequency, an outer ring counts the last days of practice,
and a typographic readout states the same facts in words. Colour is a domain's identity, never the
only encoding; every node is a focusable button; the panel keeps the calm hairline language of the
translator rather than introducing cards or elevation.

## Typography

- **Geist** (variable sans) for interface and German text.
- **Instrument Serif** italic for the editorial accent (wordmark/tagline moments).
- **IBM Plex Sans Arabic** for Arabic, via the Arabic font utility.
- Fonts are self-hosted through `@fontsource*`; there is no font CDN in the critical path. The two
  above-the-fold faces are preloaded in the root head.

Type sizes are intentional and compact (for example 22 px titles, 13–16 px body, 11 px labels with
tracking). Components use the same scale rather than arbitrary values.

## Layout and surfaces

The translator keeps a phone-first, viewport-aware workspace (`--vvh`) with safe-area padding,
but the **canvas itself hugs the content**, rather than stretching into the space below the
header. Its quiet surface has no border, inset highlight or white focus fill; depth is supplied by
the surface/background contrast. The source starts at one complete line. A CSS-grid mirror of the
exact draft (hidden from accessibility, pointer input and selection) supplies intrinsic size; a
zero-width sentinel keeps trailing blank lines intact. The native textarea still owns the caret,
selection, undo, composition and scrolling. There is **one** caret and it is the textarea's, painted
at the inline-start edge of the first glyph (left in LTR, right in RTL) — never a CSS caret, never a
pixel offset. The mirror repeats the field's direction, padding and text rendering, and
`.composer-editor` pins `text-rendering: auto` because Chromium draws a textarea with `auto`
whatever it inherits, so a document-wide `optimizeLegibility` made the mirror measure different
lines than the field drew. `tests/e2e/composer_interactions.py` (`caret_geometry`) asserts the
mirror/field agreement and the first-glyph-at-caret-edge invariant in both directions. No DOM
measurement writes or resize observers are used.

The source grows and shrinks with actual wrapping/newlines, up to **six whole lines**, **four** on
viewports ≤640 px high, **three** at ≤480 px or with the keyboard open. Beyond the cap it scrolls
natively. The result has no viewport-based minimum height, and actions follow the answer instead of
being pushed down to a distant foot. Long answers grow the canvas and scroll the workspace without
being clipped. Dictation's echo is contained by the same content-sized editor, never its toolbar.

This deliberately supersedes the fixed-three-line, screen-filling design: that design held still,
but created an oversized rectangle and dead space for short text. The stability invariant is now
**an unchanged source never resizes because a request starts, streams or settles**. Real text may
change its height; request state may not. No height animation, inline pixel sizing or self-observing
grow box is permitted (the historical box fed ~2,300 callbacks into itself).
`tests/e2e/field_layout.py` covers growth, deletion, whitespace, stream/settle stillness and overlap.

Arabic and Latin use the same 40 px source line box; language names a 32 px box, so switching script
alone or detecting a language cannot move the editing surface. Result typography stays constant
from the first chunk through settlement (24 px, 26 px at the wider breakpoint). Long words and URLs
wrap inside both fields. A short solid `--ring` stroke marks input focus without drawing a frame;
the placeholder keeps its full token contrast on focus. The language-swap icon has no fill, border
or shadow, but retains a 44 px touch target and keyboard focus outline. There is no send button:
a quiet localized hint explains automatic translation; Enter remains an optional shortcut.

The clear control is placed by the **input's** direction (not the interface's) so mixed-direction
text can never run under it. Digits and punctuation cannot choose that direction. Keyboard opening
only brings an occluded composer back into view; streamed results never force-scroll to the bottom,
and pinch zoom does not trigger a keyboard layout. The destructive pull-to-clear gesture is removed;
clearing is an explicit labelled action.
Secondary pages use a readable single column. Sheets are overlays, not routes. Radii, hairlines and shadows
stay restrained; depth comes from surface contrast and spacing rather than heavy elevation.

## Component inventory (verified)

| Component                                                    | Responsibility                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| `AppHeader` / `Wordmark`                                     | name, interface language, install offer, theme, saved, statistics |
| `LanguageBar`                                                | source/target selection and swap; source `auto`                   |
| `StyleToggle`                                                | Natural / Formal / Casual                                         |
| `BrainPicker`                                                | model selection; DeepSeek default, Luna selectable                |
| `ComposerField` / `DictationText`                            | native editing, IME/Enter/limit handling, exact dictation echo    |
| `ResultPanel`                                                | translation, copy, listen, save, shadow, current/stale states     |
| `LexiconPanel`, `SentenceShadow`                             | model-sourced readings; shadow ink, summary and two-text map      |
| `LanguageSheet`, `ShadowSheet`, `LexiconSheet`, `SavedSheet` | lazy dialogs                                                      |
| `Intro`                                                      | server-rendered first-run gate                                    |
| `FailureScreen`                                              | translated error and not-found surfaces                           |
| `ThemeToggle`                                                | three-way palette control with reveal                             |
| `SafeArea`, focus trap, feel façade                          | device and interaction infrastructure                             |

Every dialog uses `useFocusTrap`: focus enters, Tab wraps, Escape closes, focus returns to the
opener. Icon-only controls carry real labels and at least a 44 px target where they are touch
controls.

## Phase II: weather and the cultural library below the canvas

The weather strip continues the page below the translator: content-driven (~95 px), semantic tokens,
one inline glyph set, quiet freshness and visible attribution; the expanded forecast is a real dialog.

The cultural library is text-first by design. There are no images, no placeholders, no card chrome.
Richness comes from a small family of editorial compositions: a large feature with a serif headline
and deck; a compact note; a language window with the native expression at display size, its
transliteration and gloss; an everyday-scene vignette; a two-context cultural contrast with a
variation caution; and a restrained detail with a signal accent. Hairlines, generous whitespace and
one type scale hold them together. The reading dialog is an article page: rhythm over decoration,
expression/example/misunderstanding blocks, context, quiet references, related reading and save.
Arabic RTL and German/English LTR are first-class; mixed-script expressions carry their own dir and
lang; motion is one entrance and reduced-motion aware.

## Motion system (2026-11-17 coherence pass)

One duration scale and one easing family are shared by every surface: --dur-fast 140ms (press,
hover, tiny state), --dur-base 200ms (fades), --dur-enter 260ms (rises, sheets), --dur-slow 340ms
(reveals, cross-fades), with --ease-out for entrances and --ease-soft for state. Motion utilities
reference these tokens, so a card cannot drift to a different duration than a sheet.

Rules:

- Entrances are opacity + small translate only; the editorial feed uses one 260ms rise with a 45ms
  cascade for the first six cards and no delay afterwards (a new page of cards animates as it
  arrives, an endless waterfall never happens). Sheets scrim-fade and slide in; the reading view
  uses the same sheet entrance; results still arrive on the whirlwind (paint-only).
- Press feedback is immediate (40ms to scale .94), release uses the shared easing; hover
  translation and rotate transitions list their exact properties (never transition: all).
- Reduced motion keeps state legible: rises become a 140ms fade, cascades drop to 0ms, the live
  line/progress animations stop, and press scaling is removed.
- Scroll and dialog restoration stays instant; nothing animates layout (no height/width
  transitions), and no continuous loop competes with the composer.

## Alignment system

Cards (translator canvas and the weather strip) share the same 12px page inset and the same 20px
inner gutter, so their text sits on one 32px axis; the cultural library uses the same 32px content
axis for its rules, labels, headings and article text. Section rhythm is a single top rule plus a
24px gap; the footer entry keeps the same horizontal axis and one line of breathing room. Controls
use a 44px minimum touch height; inline text links keep a 36px exception only inside editorial
prose, never for primary controls.

## UI states## UI states

For the translator and result:

- **Initial**: empty composer, remembered pair/style, no result.
- **Typing / scheduled**: no spinner; the scheduler is waiting for a worthwhile pause. A previous
  reading may remain visible with an updating caption, but cannot be used or saved for the new draft.
- **Composing**: the IME owns its candidate buffer; scheduling, watchdog and explicit submission wait
  until composition ends. Enter confirms a candidate normally; Shift+Enter remains a native newline.
- **Translating / updating**: a loading state appears only after 260 ms; streaming text may replace
  it so words are visible.
- **Complete**: translation, actions, optional ambiguity/tone metadata.
- **Empty**: meaningful invitation to write, not a blank panel.
- **Error**: calm translated message, retry, draft preserved; previous result kept if one exists.
- **Offline / timeout / rate**: distinct copy; a live rate limit stays silent while typing.
- **Cancelled / superseded**: older output never overwrites newer text.
- **Disabled**: unavailable result actions are genuinely disabled and their toolbar is `inert` and
  hidden from accessibility APIs, not merely transparent. The draft remains editable.

Sheets have open, loading, empty, error and closed states. Statistics have empty and populated
states and a private (`noindex`) surface.

## Responsive and RTL

- Phone-first; tested at a 390 × 844 viewport in the e2e suite.
- Layout uses fluid widths, safe-area insets and a max readable column; long translations scroll
  inside the workspace rather than pushing the composer away.
- Arabic sets `dir="rtl"` and the Arabic face; Latin identifiers and URLs remain readable.
- Direction is applied before paint by `LOCALE_BOOT`; interface copy changes after hydration.

## What is not claimed

- No universal device/browser matrix was tested.
- No automated visual-diff suite exists; colour changes are protected by the contrast gate and
  manual/browser checks, not by pixel snapshots.
- Tokens are described by role; this document does not duplicate their numeric values, which would
  drift from `styles.css`.

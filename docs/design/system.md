# Design System

Status: **Verified** against `src/styles.css`, components and the contrast gate on 2026-11-07.
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

## Typography

- **Geist** (variable sans) for interface and German text.
- **Instrument Serif** italic for the editorial accent (wordmark/tagline moments).
- **IBM Plex Sans Arabic** for Arabic, via the Arabic font utility.
- Fonts are self-hosted through `@fontsource*`; there is no font CDN in the critical path. The two
  above-the-fold faces are preloaded in the root head.

Type sizes are intentional and compact (for example 22 px titles, 13–16 px body, 11 px labels with
tracking). Components use the same scale rather than arbitrary values.

## Layout and surfaces

The translator is a fixed, phone-first workspace with safe-area padding and a viewport-aware height
(`--vvh`) so the keyboard lifts the canvas instead of covering it. The canvas itself takes the
height the screen leaves below the header and divides it by moment (`canvasStage`: idle, writing,
translating, settled): while writing, the composer keeps most of the room; once a translation
settles, the result takes most of it while the composer keeps a strip of three-plus lines. Floors
and ceilings are expressed in `lh` and `dvh`, so an Arabic line and a small phone each get a size
of their own, and the grow weights share what remains; with the keyboard open both fields collapse
to a compact strip. The canvas never shrinks below its content: long text scrolls the workspace,
and a capped composer scrolls inside its own stage rather than opening an empty band. When a short
answer leaves room in the result, the action row settles at its foot, so the translation reads as a
composed page instead of a paragraph floating above dead space. The stage mapping is covered by
`stage.test.ts`; the split itself is CSS, not a measured height. Secondary
pages use a readable single column. Sheets are overlays, not routes. Radii, hairlines and shadows
stay restrained; depth comes from surface contrast and spacing rather than heavy elevation.

## Component inventory (verified)

| Component | Responsibility |
| --- | --- |
| `AppHeader` / `Wordmark` | name, interface language, install offer, theme, saved, statistics |
| `LanguageBar` | source/target selection and swap; source `auto` |
| `StyleToggle` | Natural / Formal / Casual |
| `BrainPicker` | model selection; Luna shows as paused |
| `ResultPanel` | translation, copy, listen, save, shadow, states |
| `LanguageSheet`, `ShadowSheet`, `LexiconSheet`, `SavedSheet` | lazy dialogs |
| `Intro` | server-rendered first-run gate |
| `FailureScreen` | translated error and not-found surfaces |
| `ThemeToggle` | three-way palette control with reveal |
| `SafeArea`, focus trap, feel façade | device and interaction infrastructure |

Every dialog uses `useFocusTrap`: focus enters, Tab wraps, Escape closes, focus returns to the
opener. Icon-only controls carry real labels and at least a 44 px target where they are touch
controls.

## UI states

For the translator and result:

- **Initial**: empty composer, remembered pair/style, no result.
- **Typing / scheduled**: no spinner; the scheduler is waiting for a worthwhile pause.
- **Translating / updating**: a loading state appears only after 260 ms; streaming text may replace
  it so words are visible.
- **Complete**: translation, actions, optional ambiguity/tone metadata.
- **Empty**: meaningful invitation to write, not a blank panel.
- **Error**: calm translated message, retry, draft preserved; previous result kept if one exists.
- **Offline / timeout / rate**: distinct copy; a live rate limit stays silent while typing.
- **Cancelled / superseded**: older output never overwrites newer text.
- **Disabled**: actions that need a result are absent or disabled, never inert.

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

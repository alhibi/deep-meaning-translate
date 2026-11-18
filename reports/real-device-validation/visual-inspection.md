# Visual Inspection — Real Device

All captures are 1080x2420 native screenshots of the **outer** display unless noted; the unfolded
capture is 2172x2352 of the **inner** display. Every image was inspected pixel-level (PIL), not only
read from the accessibility tree.

## Screens inspected

| Screen / state | Capture |
| --- | --- |
| First paint (dark, Arabic RTL) | `screenshots/01-launch.png`, `02-after-first-paint.png` |
| German draft + streamed result | `03-typed.png`, `04-translated-de.png` |
| Arabic typed with the real keyboard | `12-typed-ar.png`, `15-translated-ar-de.png`, `15b-ar-de.png` |
| Light theme (paper) | `17-theme.png`, `17b-theme-stable.png`, `20-restored.png` |
| Vivid theme | `22-theme-vivid.png` |
| Stats page | `18-stats.png` |
| Language sheet / model sheet | `23-locale-sheet.png`, `09-state.png` |
| German LTR interface | `24-locale-de.png` |
| Network error + retry | `26-airplane-error.png`, `27-retry-success.png` |
| Dictation failure (before fix) and live dictation (after fix) | `28-dictation.png`, `30-dictation-fixed.png`, `31-dictation-stopped.png` |
| Unfolded inner display | `21-unfolded-default.png` |
| Home screen (overlay check) | `19-home.png` |

## Findings

1. **No clipping, overlap or truncation** was found on the tested screens: composer, style row, model
   selector, action row, stats header and the error card all fit at 1080 px with the user's density
   override (408 dpi).
2. **Arabic RTL and German LTR are consistent**: the toolbar, language pair, style row and action row
   mirror direction while the text itself keeps its own direction (Arabic draft right-aligned inside a
   German LTR interface and vice versa).
3. **Keyboard insets work**: with the system keyboard open the result and the action row stayed above it
   in both themes; the composer never disappeared behind the IME.
4. **Status/navigation bars follow the theme**: light theme renders dark status icons, dark and vivid
   themes render light icons; the native window strip is painted with the canvas colour (no black band
   above the status bar, no mismatch at the bottom).
5. **Edge-to-edge/cutout**: the top control row sits below the 113 px status bar; the 62 px punch-hole
   cutout is not covered by text; the bottom gesture handle area is respected.
6. **A persistent black rounded rectangle at the right screen edge (x 1054–1079, y 217–454)** was
   initially suspected as an app artifact. It is present on the **Honor home launcher** as well, so it
   is the OEM side-panel handle, **not** the app. No app-side fix is justified.
7. **Unfolded (inner 2172x2352)**: the portrait-locked app renders a centred, max-width canvas with large
   side margins. Nothing breaks, but there is no tablet/landscape composition — this matches the
   documented decision in `docs/android/device-compatibility.md` (portrait lock in 1.0.3).
8. **Dictation UI (after the fix)** shows the live transcript inside the composer with the same styling
   as typed text; the stop control returns the field to the editable state.

## Classification

- Critical visual problems on the target device: **none found**.
- Layout adaptation on the foldable inner display is minimal by design (documented), not a defect.
- Font-scale and hostile-string stress passes were **NOT TESTED** and are not claimed.

## Round 3 additions (visual)

- **Long text layout:** with 1,720 characters the composer grows to 4 visible lines and then scrolls
  natively (no height jump, no clipped line at the bottom); the Arabic result below the card wraps
  correctly and the workspace scrolls once the keyboard is open. No overlap or truncation observed.
  Capture: `screenshots/40-longtext-typed.png`, `screenshots/41-longtext-result.png`.
- **System font scale is not reflected:** at `font_scale=1.3` the rendered interface is unchanged
  (cold relaunch). The app does not scale with the accessibility font setting — recorded as an
  accessibility gap in `functional-test-results.md`; not a layout break at the default scale.
- **Model sheet and style rows** render the selected state with the clay underline and fit at the
  user's density override (408 dpi); Sona/Velo rows and the language sheet were visually checked.
  Captures: `screenshots/34-model-sona.png`, `screenshots/35-style-formal.png`.
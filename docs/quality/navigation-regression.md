# Navigation Regression

Status: **Scenario authored and validated manually in a browser; executed 2026-11-14 on the dev
server with a hydration wait.** Two restore checks fail because the script seeds storage after load
and the app's `pagehide` flush removes the session; see the Task 2 report. The measured results
below come from the production bundle.

## What must remain true

1. Internal navigation keeps one document (`performance.getEntriesByType("navigation").length` does
   not increase).
2. The root/body background does not change at any sampled frame.
3. Returning to `/` paints the remembered draft and translation; no translation POST is issued.
4. The restored pair is the session's pair, not a later preference pair.
5. Theme and document direction are correct before paint.
6. Repeated and rapid cycles do not throw, blank the screen or lose the draft.
7. The browser-chrome `theme-color` follows the active palette on routes without a theme control.

## Automated scenario

`tests/e2e/navigation_stability.py` (Playwright, Python) does the following at 390 × 844:

- seeds a session in `de → ar` with a known result, preferences in `auto → en`, a seen intro and a
  theme;
- loads `/?sw=off` (so a preview service worker cannot contaminate the run);
- records page errors and non-GET requests;
- samples `html`/`body` backgrounds on every animation frame while navigating;
- navigates `/` → `/stats` → `/` repeatedly (normal and rapid), checking the composer, the restored
  translation and the absence of an error boundary;
- asserts the document count stays one;
- repeats in the light theme and checks the meta `theme-color` against the computed background on
  `/stats`.

Run it with the app up:

```sh
npm run dev            # or: npm run build && npm run preview
python3 tests/e2e/navigation_stability.py
```

It needs `playwright` for Python. It is not part of CI.

## Service-worker navigation

`tests/e2e/pwa_navigation.py` runs against the production build (`npm run build && npm run preview`).
It waits for the worker to control the page, then navigates twice online (reload `/`, then `/stats`
and back). Both must render the app, and the document must appear in the `lingua-shell` cache. It
then deletes that cache and goes offline: the navigation must reach `/offline.html` only then. The
old build failed this test because the offline page answered every navigation.

## Product unit coverage (executed)

| Test | What it protects |
| --- | --- |
| `src/lib/translation/restore.test.ts` | session pair wins; `auto` request on strong mismatch; effective brain; cached result carried |
| `src/lib/translation/useTranslator.test.tsx` | a carried-over result starts `COMPLETE`, paints immediately, and spends no request |
| `src/lib/storage.test.ts` | `persist.remembered()` holds the tab's last session/prefs and is cleared by `clearAll()` |
| `src/lib/localeBoot.test.ts` | pre-paint `lang`/`dir`, stored/browser fallback, storage failure |
| `src/lib/theme.test.tsx` | theme validation/migration and the no-stylesheet guard for browser chrome |

## Measured evidence (production bundle)

- `/` → `/stats` → `/`: one document; composer and translation present **~64 ms** after the click.
- Fetch instrumentation: **no non-GET requests** during the cycle.
- Frame sampling: one background pair only, `rgb(18, 16, 15)` for both `html` and `body`.
- 8 normal + 6 rapid dark cycles: **17/17 checks clean**, no boundary, no page error.
- 8 light-theme cycles: **8/8 clean**, SPA marker preserved, no console error.
- Dark `theme-color` on `/stats`: `#12100f`; light: `#f7f3ec` (matches computed `--background`).

## Limits

- Browser automation was limited to one Chromium-based cloud browser; no Firefox/WebKit run.
- The Python navigation script was executed on 2026-11-14 (dev server); its two restore checks fail
  on the seeding order described above.
- Two isolated boundaries were observed after build/server/preview switches; neither reproduced
  after cleanup (25 clean checks). They are recorded as SUSPECTED environment artifacts (TD13),
  not as a product defect with a proven cause.
- Frame sampling proves computed colours, not rendered pixels; no video/pixel-diff evidence was
  produced.

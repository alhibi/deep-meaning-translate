# Navigation, Boot and Lifecycle

Status: **Verified** by source inspection, unit tests and runtime observation on 2026-11-07. This
document explains the defect that made the app feel rebuilt, the corrections, and the evidence.

## 1. Why the app felt reconstructed

Two independent causes produced one sensation.

### Cause A — the restored translation was primed under the wrong pair

On boot, `src/routes/index.tsx` restored the session text but primed the translation cache with the
**preference** pair while the UI kept the **session** pair. The request key therefore never matched
the primed key. The draft returned, the translation disappeared, and the sentence was requested
again — a visible rebuild and a second paid request.

The fix is a pure function, `src/lib/translation/restore.ts`:

- the session owns `source`, `target`, `style` and the result;
- preferences only fill the dialect and brain;
- a strong writing-system mismatch is sent as `requestSource: "auto"`, while the bar still shows
  the session's pair;
- the restored result is passed to `useTranslator` as `restored`, so `phase` starts at `COMPLETE`,
  the key is already committed, and the scheduler neither re-requests nor replaces it with a
  loading state.

### Cause B — the route remounted with empty initial state

TanStack Router unmounts the translator when navigating to `/stats`. The component's `useState`
defaults were empty, so the first paint after returning was an empty composer; storage was read in
an effect afterwards. That is the observable "rebuild".

`src/lib/persist.ts` now keeps the tab's last validated prefs and session in module memory, and
`persist.remembered()` seeds the translator's initial state. On a cold document load the memory is
empty, so server HTML and client hydration still agree; storage remains the cross-reload source of
truth.

## 2. Root shell and boot order

`src/routes/__root.tsx` renders the document once. Inline scripts run before `HeadContent` and
before hydration:

1. `THEME_BOOT` — validates the saved theme, falls back to system preference, sets the class,
   `data-theme` and `color-scheme` on `<html>`.
2. `LOCALE_BOOT` — validates the saved interface locale, falls back to the browser language, sets
   `lang` and `dir`. This prevents an English, left-to-right page from reflowing into Arabic RTL.
3. `INTRO_BOOT` — decides whether the first-run introduction is shown; CSS, not a late overlay,
   controls visibility.

After mount, the root effect calls `syncThemeColor()` so the browser-chrome colour follows the
computed `--background`, including on `/stats`, which mounts no theme control.

## 3. Visual continuity

In `src/styles.css`:

- `html` owns an explicit background and `scrollbar-gutter: stable`, so the canvas is never the
  browser default and a scrollbar appearing on a secondary route cannot shift the layout.
- The `::view-transition` overlay carries `var(--background)`. A cross-fade is two partially
  transparent snapshots; without a backdrop the browser canvas can show through as a colour flash.
- Both snapshots use `mix-blend-mode: normal` and the same **220 ms** duration and easing, so the
  cross-fade stays perceptually even instead of over-weighting one page.
- Theme switching is a separate movement: `html.theme-reveal` suppresses the default root fade
  while the clip-path reveal runs from the touched control.

Motion respects `prefers-reduced-motion`; the transition is continuity, not decoration.

## 4. What is preserved, and what is not

Preserved across `/` → `/stats` → `/`:

- the root shell, theme, locale and providers (no document reload);
- the draft, pair, style, dialect, brain and last translation (remembered session);
- the settled translation without a new request (cache priming + `restored`).

Not preserved by design:

- open sheets and transient toasts (route-local UI);
- scroll position of the translator (the page is a fixed workspace; statistics restore their own
  scroll where the router supports it);
- provisional live text is not treated as a permanent result.

## 5. Evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Single document across navigation | PASS | `performance.getEntriesByType("navigation").length === 1` before/after cycles |
| Return paints the draft and translation | PASS | production bundle: composer and translation present ~64 ms after click |
| No translation request on return | PASS | fetch instrumentation recorded no non-GET requests during the cycle |
| Background stability | PASS | every sampled frame: `html` and `body` = `rgb(18, 16, 15)` |
| Repeated / rapid cycles | PASS | 17/17 dark checks (8 normal + 6 rapid) and 8/8 light cycles; no boundary |
| Theme colour on `/stats` | PASS (dark + light) | meta `#12100f` dark, `#f7f3ec` light; root sync effect |
| Unit regression: restore plan | PASS | `src/lib/translation/restore.test.ts` |
| Unit regression: restored result | PASS | `useTranslator.test.tsx` "carries a restored result" |
| Unit regression: locale boot | PASS | `src/lib/localeBoot.test.ts` |

Two isolated route boundaries were observed during preview runs that had just switched builds or
servers (one with a stale service worker serving an older shell, one in a freshly opened tab). Both
disappeared after clearing preview state, and neither reproduced in 17 dark checks, 8 light cycles,
or the settled/immediate theme-transition navigation checks. They are recorded as **SUSPECTED**
preview/environment artifacts (TD13), not as a resolved product defect: the code-level cause was not
proven. See `docs/architecture/decisions/0004-service-worker-and-offline-shell.md`.

## 6. Acceptance criteria

1. One document for internal navigation; no full reload.
2. No background or theme flash at any frame of the transition.
3. Return to `/` shows the remembered draft and translation immediately; no new request.
4. The session's pair wins over later preferences.
5. Theme and direction are correct before paint.
6. Repeated, rapid and back/forward navigation do not throw or lose the draft.
7. Reduced motion is respected; no animation hides a blank frame.

The automated scenario is `tests/e2e/navigation_stability.py`; see
`docs/quality/navigation-regression.md`. It requires Playwright and a running app and is not part of
CI in this repository.

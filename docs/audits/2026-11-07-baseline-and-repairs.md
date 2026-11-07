# Engineering Baseline and Repairs — 2026-11-07

Status: **Verified**. This is the evidence record for the maturity initiative. It does not replace
the specifications; it explains what was found, what changed and what remains.

## Environment and method

- Repository: `alhibi/deep-meaning-translate`, branch `freebuff/a732ac8a763f1d05fdfa9d70`.
- Stack discovered, not assumed: TanStack Start 1.168, TanStack Router 1.170, React 19.3, Vite 8.3,
  Tailwind 4.3, TypeScript 6, Zod 4, Vitest 5, vite-plugin-pwa.
- Baseline gates were run **before** edits; findings were traced in source and, where possible,
  reproduced in a Chromium-based cloud browser against both the dev server and the production
  Node adapter.
- No provider keys were available. Model quality, speech providers and live failure modes are
  **NOT_VERIFIED**.
- No commit, push, deploy or release was performed. The working tree holds the changes.

## Baseline (before edits)

| Gate | Result |
| --- | --- |
| `npm ci` | completed, lockfile preserved |
| `npm run typecheck` | PASS, 0 errors |
| `npm run lint -- --max-warnings 0` | PASS |
| `npm run test` | **289 passed, 4 skipped, 48 files** |
| `npm run check:contrast` | **51 pairs pass** |
| `npm run build` | PASS |
| `node scripts/check-pwa.mjs` | **37 precached files** |

The baseline was already healthy. The audit therefore focused on behaviour that gates cannot see:
state continuity, navigation, first paint and browser chrome.

## Findings and repairs

### D1 — Restored translation disappeared and was paid for twice (P1)

- **Observed**: returning to `/` restored the draft but not the translation; `/api/translate-stream`
  was requested again.
- **Root cause**: boot primed the cache with the **preferences** pair while the visible state kept
  that same pair, but the session had been written in a different pair. The request key could never
  match the primed key.
- **Repair**: pure `restorePlan(session, prefs)`; session owns pair/style/result; preferences fill
  dialect/brain; `requestSource` becomes `auto` only on a strong script mismatch;
  `useTranslator` accepts a `restored` result and starts committed/complete.
- **Files**: `src/lib/translation/restore.ts` (new), `src/routes/index.tsx`,
  `src/lib/translation/useTranslator.ts`, `src/lib/persist.ts`.
- **Tests**: `restore.test.ts` (4), `useTranslator.test.tsx` carried-result case.
- **Status**: fixed and verified in unit tests and the production browser (draft + translation on
  first paint, no request).

### D2 — Route remount painted an empty translator (P1)

- **Observed**: `/` → `/stats` → `/` showed an empty composer before storage was read; perceived as
  an app rebuild.
- **Root cause**: route components unmount; `useState` started empty and restore ran in an effect.
- **Repair**: module-level remembered prefs/session in `persist.ts`; translator initial state seeded
  from `persist.remembered()`; remembered values updated on every save and cleared by `clearAll()`.
- **Files**: `src/lib/persist.ts`, `src/routes/index.tsx`.
- **Tests**: `storage.test.ts` remembered-values case.
- **Status**: fixed; production return paints composer and translation ~64 ms after the click.

### D3 — Background/colour shift during route transitions (P2)

- **Observed**: `html` computed background was transparent while `body` carried the theme colour;
  the view-transition overlay had no backdrop and the two snapshots used different durations
  (180 ms out, 260 ms in).
- **Root cause**: a cross-fade is two partially transparent snapshots for most of its life; the
  browser canvas could show through, and the asymmetric timing over-weighted one page.
- **Repair**: explicit `html` background + stable scrollbar gutter; `::view-transition` carries
  `var(--background)`; both snapshots normal blend and the same 220 ms duration/easing.
- **Files**: `src/styles.css`.
- **Evidence**: frame sampling across transitions showed only `rgb(18, 16, 15)` for `html` and
  `body`; 25 dark/light navigation checks clean.
- **Status**: fixed.

### D4 — Browser-chrome colour stale on routes without a theme control (P2)

- **Root cause**: the `theme-color` meta was only updated by `ThemeToggle`; `/stats` mounts no such
  control, so it could keep the server's dark value in a light session.
- **Repair**: `syncThemeColor()` in `theme.ts` (ignores an empty computed value, so jsdom cannot
  blank the meta); called by `apply()` and once from the root effect.
- **Files**: `src/lib/theme.ts`, `src/routes/__root.tsx`.
- **Tests**: theme test for the no-stylesheet guard.
- **Verified**: dark `/stats` meta `#12100f`; light `/stats` meta `#f7f3ec`, matching the computed
  `--background`. Eight light-theme navigation cycles were clean.

### D5 — First paint could be LTR English before an Arabic RTL layout (P2)

- **Repair**: `LOCALE_BOOT` validates the stored locale, falls back to the browser language, and sets
  `lang`/`dir` before paint. It is built from the same `normalizeLocale` function React uses, so the
  two cannot disagree. Storage failure still allows the browser fallback.
- **Files**: `src/lib/i18n.ts`, `src/routes/__root.tsx`.
- **Tests**: `localeBoot.test.ts` (4).
- **Limitation**: the **copy** is still translated after hydration; SSR emits English copy. This is
  recorded as debt, not hidden.

### D6 — Deprecated server-function validator API (P3)

- **Observed**: TanStack warned that `inputValidator()` is deprecated.
- **Repair**: `.validator()` in `translate.functions.ts`, `lexicon.functions.ts`,
  `shadow.functions.ts`. No schema or behaviour change.
- **Status**: fixed; typecheck, lint and tests pass.

### D7 — Dead font-CDN runtime cache (P3)

- **Observed**: a Workbox rule cached `fonts.googleapis.com`/`fonts.gstatic.com`, but fonts are
  self-hosted and the rule could never match.
- **Repair**: rule removed from `vite.config.ts`. Precache remains 37 files.
- **Status**: fixed.

### D8 — Stale service worker in an ephemeral preview (environment, not product)

A production preview registered the worker on a preview host. After switching the server to a dev
build, the worker served the old production shell; an internal navigation then raised a route error
boundary. Clearing the worker/caches removed it; it did not reproduce in 17 dark checks, 8 light
cycles, or a fresh production preview with `?sw=off`. A second, unexplained boundary occurred once in
a freshly opened worker-less tab and also did not reproduce. Both are recorded as **SUSPECTED**
preview/environment artifacts (TD13), not as a resolved product defect. Documented in ADR 0004. The
product's dev/preview refusals are correct for Lovable hosts; ephemeral agent previews are not in
that list.

## Verification matrix

| Area | Check actually run | Result | Evidence |
| --- | --- | --- | --- |
| Types | `npm run typecheck` | PASS | 0 errors |
| Lint/format | `npm run lint -- --max-warnings 0` | PASS | 0 warnings |
| Unit/integration | `npm run test` | PASS | 300 passed, 4 skipped, 50 files |
| Colour | `npm run check:contrast` | PASS | 51/51 pairs |
| Build | `npm run build` | PASS | Worker bundle + headers |
| PWA | `node scripts/check-pwa.mjs` | PASS | 37 precached files |
| Navigation | production bundle, 25 dark/light checks | PASS | one document, ~64 ms, no POST, one background |
| Theme chrome | `/stats`, dark + light | PASS | meta `#12100f` / `#f7f3ec` |
| Provider quality | live request with keys | NOT_VERIFIED | no keys |
| E2E Python | `python3 tests/e2e/navigation_stability.py` | NOT_VERIFIED | Playwright not installed |
| Dependency audit | `npm audit` | NOT_VERIFIED | not part of the audit |
| Real-device a11y | screen reader / reduced motion device | NOT_VERIFIED | no device |

## Maturity assessment (qualitative, evidence-based)

No numeric score is manufactured. "Strong" means the behaviour is verified and protected by a gate
or regression test; "Adequate" means it is understood and works but has a named coverage gap;
"Gap" means it cannot be asserted yet.

| Domain | Assessment | Basis |
| --- | --- | --- |
| Architecture | Strong, one debt | clear boundaries, server-owned secrets; large translator route |
| Functional correctness | Strong on tested paths | 300 tests, restore/navigation regressions covered |
| Translation quality | Gap | no keys, no reviewed corpus; deterministic checks only |
| Navigation/rendering | Strong after repairs | one document, stable background, fast restore |
| UI/UX consistency | Strong, visual gap | tokens + 51 contrast pairs; no pixel-diff suite |
| Performance | Adequate | measured return latency; no profiling/long-run memory |
| Security | Adequate | source-verified boundaries; no pen test or dependency audit |
| Testing | Adequate | broad unit suite; e2e not in CI; no visual regression |
| Maintainability | Adequate | documented, typed; route size |
| Documentation | Strong (new) | indexed, source-referenced, gated by `check:docs` |

## Remaining limitations

See `docs/audits/technical-debt.md` for the register and remediation. The most important:
provider quality is unproven; the e2e suite is not in CI; interface copy is not server-localized;
rate limits are process-local; no visual regression evidence.

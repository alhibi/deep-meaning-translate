# Testing Strategy

Status: **Verified** after the full-stack upgrade on 2026-11-17 (evening run). Counts below are from
executed commands, not estimates. The Android rows dated 2026-11-16 stay historical; the 2026-11-17
Android rows are the ones executed for this upgrade. Details and evidence:
[the upgrade audit](../audits/2026-11-17-upgrade.md).

## Gates

| Command                            | What it proves                                               | Latest executed result (2026-11-17)                                                   |
| ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `npm run typecheck`                | TypeScript consistency                                       | PASS, 0 errors                                                                        |
| `npm run lint -- --max-warnings 0` | ESLint + Prettier                                            | PASS, 0 warnings                                                                      |
| `npm run test`                     | Vitest unit/integration suite with coverage                  | **735 passed, 4 skipped, 99 files**                                                   |
| `npm run check:contrast`           | WCAG AA for theme token pairs                                | **51/51 pairs**                                                                       |
| `npm run check:docs`               | Documentation links and inventory                            | PASS, all current documents indexed                                                   |
| `npm run build`                    | Worker bundle + headers + PWA generation                     | PASS after the upgrade; see "Executed upgrade"                                        |
| `npm run check:pwa`                | Non-empty precache with hashed assets                        | PASS; **54 precached files, 52 hashed assets**                                        |
| `npm run build:native:web`         | Prerendered native web assets and CSP preparation            | PASS; **11 entries**; no APK/device claim                                             |
| `npm run test:e2e:fields`          | Native editing, stream ownership, field geometry and caret   | **39 geometry + 109 interaction/caret checks**, production preview (Chromium 140; 153 confirmed) |
| `npm run test:e2e:nav`             | Session restore, SPA navigation, background/theme continuity | **15 checks**, production preview                                                     |
| `npm run test:e2e`                 | General Python Playwright smoke script                       | Not rerun in this editor follow-up                                                    |

`npm run verify` ran types, zero-warning lint, coverage tests, contrast and docs together.
Coverage floors in `vitest.config.ts` (statements/branches/functions/lines: **46/39/39/48**) are a
regression guard, not a quality score. This run measured **53.03/45.43/46.03/55.51** respectively.
The 2026-11-14 baseline measured 51.79/41.86/42.92/53.74. Four explicitly skipped tests remain
skipped, not passed.

## Executed upgrade (2026-11-17)

Every number in this section comes from a command run in this environment; the audit records the
classifications and the remaining gaps.

- **Unit/integration**: the full Vitest suite after the upgrade — **99 files, 735 tests passed, 4
  skipped** (the upgrade added coverage for capability profiles, completion contracts, the enrichment
  queue, NFC identity, storage reconciliation, statistics memoisation, lexicon parsing/gating, shadow
  anchoring/windowing/eval, the composer mirror contract and the stylesheet build guard). Coverage
  floors are unchanged.
- **Browser suites, against the production preview** (`npm run build` then `PORT=8090 npm run preview`):
  - `composer_interactions.py`: **109 checks** (was 76). The suite gained the `caret_geometry` section
    (mirror/field inline-metric agreement and "first glyph sits at the native caret's inline-start
    edge" in RTL and LTR), the removal of the visible "translates as you type" caption (with the
    screen-reader description kept), and a platform-correct undo accelerator (Command on macOS,
    Control elsewhere). The rest is unchanged and still runs the real scheduler/parser/components
    with a controllable stream at the fetch boundary.
  - `field_layout.py`: **39 checks**. Now also brings the headless page to the front before asserting
    the focus marker, because `:focus`/`:focus-visible` only match while the document is focused.
  - `navigation_stability.py`: **15 checks**.
  - `seo_navigation.py`: **21 checks** (rewritten): exactly one footer entry, both legacy paths answer
    **301** and land on their `/about` section, self-canonical indexable `/about`, and the three
    localizations render their own title and sections.
  - `shadow.py` (live model, synthetic text): **44 checks** on a 424-wide Arabic phone and a 1280-wide
    German desktop: no shadow while typing, arrival after settle, linked counterpart highlighting,
    stacked vs side-by-side layout, separated strength/confidence, diff preview before applying,
    apply + archive + undo, toggle off.
  - `pwa_navigation.py`: **8 of 9 checks** pass (worker ready and controlling, both online navigations
    render the app, the document is cached by NetworkFirst). The offline-fallback check is
    **NOT_VERIFIED** in this environment: Playwright's offline emulation did not gate the
    service-worker fetch, so the navigation reached the preview server's 404 shell instead of failing.
    `npm run check:pwa` still proves the precache is non-empty and `offline.html` is precached.
- **Stylesheet/Android build guards**: `src/lib/styles.test.ts` fails if any `@keyframes` animates a
  logical property, and `scripts/prepare-native-web.mjs` fails the native build if the lowered CSS
  gives `.composer-editor` a physical left/right offset. Both exist because of D73: a dead keyframe
  was hoisted onto the editor rule by Lightning CSS in the Chrome 80 target and moved the whole field
  (and the caret) off its canvas in the packaged app only.
- **Android (2026-11-17)**: `./gradlew :app:testDebugUnitTest` — **13 tests, 0 failures**;
  `./gradlew :app:assembleDebug` — PASS; `apksigner verify` reports a V2 **debug** certificate (not a
  publishable artefact); the APK was installed on emulator-5554 (API 35, WebView 124) and the app was
  exercised: cold launch, restored session, LTR/RTL composer geometry, empty-field RTL caret measured
  from the framebuffer (995–997 device px against an expected 997.5), and `/about` reached from the
  single footer entry. `connectedDebugAndroidTest` and any release build were **not** run
  (no upload keystore; signing fails closed) — TD17/TD42.
- **Deterministic evaluation**: `node tests/eval/shadow_eval.ts` — **19/19** cases pass (ar→de and de→ar,
  MSA and Levantine, daily and formal, idiom, sarcasm, respect, implied meaning, joke, ambiguity, and
  correct translations with nothing lost); no paid call is made.

## Android gates

| Command                                                                      | What it proves                                                                                         | Result on 2026-11-16                                                                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `./gradlew :app:testDebugUnitTest`                                           | Repository merge/trim/session guard, JSON mapping, migration 1→2, the backup UTF-8 reader              | **13 passed, 0 failed** (Repository 7, Migration 3, BackupReader 3)                                                      |
| `./gradlew :app:connectedDebugAndroidTest`                                   | Real Capacitor bridge: packaged origin/shell, storage round trip, namespace refusal, session seq guard | **3 passed, 0 failed** on emulator API 35                                                                                |
| `./gradlew :app:assembleDebug :app:assembleRelease -PallowDebugSigning=true` | Kotlin compiles, Room KSP runs, R8 shrinks, both APKs sign                                             | PASS (v2 signature verified)                                                                                             |
| `./gradlew :app:assembleRelease` without signing                             | Fail-closed release signing                                                                            | expected failure, executed                                                                                               |
| `apksigner verify`, `aapt2 dump badging`, `unzip`                            | Signature, package, SDK, permissions, packaged assets/CSP, debug flag, no keys                         | PASS                                                                                                                     |
| Device install/run                                                           | Keyboard, theme, back, restore, SAF, stats, release APK                                                | **executed on API 35 emulator**, see `ANDROID_TEST_EVIDENCE.md`; API 24–29 and OEM/foldable hardware remain NOT_VERIFIED |

Kotlin tests run on the JVM with Robolectric; the migration test creates a real v1 SQLite schema
with a row and opens it through Room v2. The dated connected tests above cover real bridge round
trips on the API 35 emulator. They are not evidence that these latest editor changes were exercised on a physical keyboard or WebView;
that remains a separate device check.

## Test architecture

- **jsdom + Testing Library**, globals off, cleanup registered in `src/test/setup.ts`.
- Pure logic is tested directly: scheduler, prompt, parse, verify, restore plan, language check,
  memory, statistics, persistence validators, theme parsing, locale boot.
- Hooks are tested with `renderHook` and fake timers/streams: cancellation, superseding, live
  settling, cache hits, restored results, offline behavior.
- Components are tested for real semantics (dialogs, focus trap, failure screens), not snapshots.
- Network is faked at the boundary; tests never call a paid provider.
- Device storage is shared within a test file; a network-path test must clear translation memory
  first, or a previous sentence will answer for it.

## Evidence classifications

Use these in findings and reports:

- **VERIFIED** — source inspection and/or an executed test confirms it.
- **OBSERVED** — seen in a running app/browser.
- **SUSPECTED** — plausible, not confirmed.
- **NOT_VERIFIED** — could not be tested (credentials, device, environment).
- **NOT_APPLICABLE** — does not apply to this architecture.

Never report a skipped or unrun check as a pass. A route that renders is not proof that its
behaviour works.

## End-to-end suite

`tests/e2e/*.py` are phone-sized Playwright scripts against `http://localhost:8080`. They cover
smoke, navigation, service-worker navigation, adversarial input, statistics, themes, voice and
shadow, with network fakes for translation. They are **not wired into CI**. Task 2 executed them on
a dev server with a hydration wait: smoke and SEO passed; several journeys were **NOT_VERIFIED**
because the headless browser closed (see `docs/audits/2026-11-14-task2-request-lifecycle.md`).
`tests/e2e/pwa_navigation.py` runs against the production build (`npm run preview`) and proves that
an active worker serves the app for online navigations and `/offline.html` only when a fetch fails.
The navigation scenario is documented in `docs/quality/navigation-regression.md`.

### Executed content-led canvas follow-up (2026-11-17)

- `field_layout.py`: **39 checks**. Compact borderless idle canvas; a one-line source that grows
  and shrinks with exact whitespace/newlines to its whole-line cap; independent native scrolling;
  stream/settle stillness for an unchanged source; close-following result actions; reserved RTL
  clear-control space; no overlap, clipping, inline-height writes or resize loop. The focused
  placeholder keeps its opacity and focus is a short stroke, not a white frame.
- `composer_interactions.py`: **76 checks** using controllable `ReadableStream` responses at the
  fetch boundary. The real scheduler, parser and components run; no paid provider is called. Covers
  automatic submission without a send button, source/result growth and shrinkage during real chunks,
  native multiline replacement/undo, stale actions/session eligibility, shorter replacement streams,
  exact Copy, newline/IME guards, 5,000-unit emoji-safe limits (including Swap), delayed clipboard
  permissions and simulated keyboard/pinch transitions. Source caps are 6/4/3 whole lines for tall,
  short/landscape and keyboard layouts, not fixed empty space. An already-settled result remains
  saveable and present in the device session when connectivity drops.
- Responsive coverage is **15 combinations**: five viewports (320×568, 390×844, 768×1024,
  1440×900, 844×390) × three interface locales, with light/dark/vivid rotated between cases and the
  actual applied theme asserted. It is not the full 45-case cross-product.
- `navigation_stability.py`: 15 checks, seeded before the first boot, deterministic refused
  provider transport, cold and route-return restore, repeated/rapid cycles, one document and no
  translation POST on return.
- All **130 checks** (39 + 76 + 15) passed on the final production bundle served locally. The
  interaction fixture waits for the actual SSR `.intro-screen` to unmount after boot, not merely
  the absent pre-paint `data-intro` flag; Clear waits for the hook's result reset before measuring
  geometry. A new URL fixture trims the space before its newline to match request normalization.
  These repair test readiness/fixtures, not production persistence or the security policy.
- A sandbox-only adapter
  permits preview embedding; shipped `_headers` are unchanged, and `script-src` is not relaxed.
  Playwright wait predicates are functions, not string expressions that need CSP `unsafe-eval`.
- Final compact idle/settled screenshots in all three themes and a stale/offline result were
  inspected after finite transitions. No new
  physical-device frame-rate claim or automated pixel-diff baseline is made.

Activate a Python environment with Playwright/Chromium before running the npm E2E commands.
`E2E_URL` selects a running app (default `http://localhost:8080`); optional `CHROMIUM_PATH` and JSON
`CHROMIUM_ARGS` select an installed browser. The interaction script writes screenshots under
ignored `output/composer/` (`E2E_ARTIFACTS` can override it). Logs and screenshots are disposable,
not committed evidence containing real user drafts. Details: [Arabic editor review](../audits/2026-11-17-composer-review-ar.md).

## What is covered well

- request identity, cancellation, deduplication and restore;
- deterministic translation verification and prompt invariants;
- storage validation and migration;
- theme/locale boot logic;
- failure screens and dialog focus;
- statistics computation.

## What is not covered

- real provider quality, latency and failure modes (no keys);
- visual regression/pixel diffs;
- real-device keyboard, screen reader, reduced motion and installation;
- long-run memory growth and large-text profiling;
- deployment-wide rate limiting and edge bot protection;
- dependency vulnerability scanning in CI (`npm audit` was not part of the audit gates).

## Adding tests

1. Prefer the smallest test that would fail on the old behavior.
2. Assert behaviour, not implementation details; never weaken an assertion to make a build pass.
3. Fake the network and time deterministically; no arbitrary sleeps where a controlled clock works.
4. Add a navigation/theme test when touching boot, routing, transitions or session restore.
5. Record any check you could not run as **NOT_VERIFIED**, with the reason.

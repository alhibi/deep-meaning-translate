# Testing Strategy

Status: **Verified** web/editor follow-up on 2026-11-17. Counts below are from executed commands,
not estimates. The Android table retains its dated 2026-11-16 evidence; Gradle and devices were not
rerun in this follow-up.

## Gates

| Command                            | What it proves                                               | Latest executed result (2026-11-17)                                                   |
| ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `npm run typecheck`                | TypeScript consistency                                       | PASS, 0 errors                                                                        |
| `npm run lint -- --max-warnings 0` | ESLint + Prettier                                            | PASS, 0 warnings                                                                      |
| `npm run test`                     | Vitest unit/integration suite with coverage                  | **511 passed, 4 skipped, 78 files**                                                   |
| `npm run check:contrast`           | WCAG AA for theme token pairs                                | **51/51 pairs**                                                                       |
| `npm run check:docs`               | Documentation links and inventory                            | PASS, all current documents indexed                                                   |
| `npm run build`                    | Worker bundle + headers + PWA generation                     | PASS; **56 precached files**                                                          |
| `npm run check:pwa`                | Non-empty precache with hashed assets                        | PASS; **54 hashed assets**                                                            |
| `npm run build:native:web`         | Prerendered native web assets and CSP preparation            | PASS; **11 entries**; no APK/device claim                                             |
| `npm run test:e2e:fields`          | Native editing, stream ownership and field geometry          | **23 geometry + 44 interaction/matrix checks**, Chromium 153, final production bundle |
| `npm run test:e2e:nav`             | Session restore, SPA navigation, background/theme continuity | **15 checks**, Chromium 153, final production bundle                                  |
| `npm run test:e2e`                 | General Python Playwright smoke script                       | Not rerun in this editor follow-up                                                    |

`npm run verify` ran types, zero-warning lint, coverage tests, contrast and docs together.
Coverage floors in `vitest.config.ts` (statements/branches/functions/lines: **46/39/39/48**) are a
regression guard, not a quality score. This run measured **52.74/44.90/45.72/55.19** respectively.
The 2026-11-14 baseline measured 51.79/41.86/42.92/53.74. Four explicitly skipped tests remain
skipped, not passed.

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

### Executed editor follow-up (2026-11-17)

- `field_layout.py`: 23 checks, stable 120 px/three-line source, independent source scrolling,
  streaming/settled stillness, reserved RTL clear-control space, no overlap, clipping or resize loop.
- `composer_interactions.py`: 44 checks using controllable `ReadableStream` responses at the fetch
  boundary. The real scheduler, parser and components run; no paid provider is called. Covers stale
  actions/session eligibility, shorter replacement streams, exact Copy, selected-word replacement
  and native undo, newline/IME guards, 5,000-unit emoji-safe limits (including Swap), delayed
  clipboard permissions and simulated keyboard/pinch transitions. An already-settled result remains
  saveable and present in the device session when connectivity drops.
- Responsive coverage is **15 combinations**: five viewports (320×568, 390×844, 768×1024,
  1440×900, 844×390) × three interface locales, with light/dark/vivid rotated between cases and the
  actual applied theme asserted. It is not the full 45-case cross-product.
- `navigation_stability.py`: 15 checks, seeded before the first boot, deterministic refused
  provider transport, cold and route-return restore, repeated/rapid cycles, one document and no
  translation POST on return.
- These scripts passed on the final production bundle served locally. A sandbox-only adapter
  permits preview embedding; shipped `_headers` are unchanged, and `script-src` is not relaxed.
  Playwright wait predicates are functions, not string expressions that need CSP `unsafe-eval`.
- Final idle/result/updating/offline screenshots were inspected after finite transitions. No new
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

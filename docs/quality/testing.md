# Testing Strategy

Status: **Verified** on 2026-11-16. Counts below are from executed commands, not estimates.

## Gates

| Command                            | What it proves                              | Audit result                                            |
| ---------------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| `npm run typecheck`                | TypeScript consistency                      | PASS, 0 errors                                          |
| `npm run lint -- --max-warnings 0` | ESLint + Prettier, zero warnings            | PASS                                                    |
| `npm run test`                     | Vitest unit/integration suite with coverage | **393 passed, 4 skipped, 69 files**; coverage collected |
| `npm run check:contrast`           | WCAG AA for every theme pair                | **51/51 pairs**                                         |
| `npm run check:docs`               | Documentation links and inventory           | added in this audit                                     |
| `npm run build`                    | Worker bundle + headers + PWA check         | PASS; **37 precached files**                            |
| `npm run check:pwa`                | Non-empty precache                          | PASS                                                    |
| `npm run test:e2e`                 | Python Playwright phone checks              | Requires Playwright + running app; **not run here**     |

Coverage floors are enforced by `vitest.config.ts` (statements/branches/functions/lines:
48/46/39/39) and `npm run test` collects coverage, so the run fails when a floor is missed. The
2026-11-14 baseline measured 51.79/41.86/42.92/53.74. Floors are a regression guard, not a quality
score.

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
with a row and opens it through Room v2. The bridge itself (Capacitor reflection) is covered only by
compilation and plugin registration; a device smoke test remains the honest gap.

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

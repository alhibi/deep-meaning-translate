# Android Gap Analysis — 2026-11-16

Phase 1 output. Seven independent read-only audits (A1–A7, reports under
`docs/audits/android-team/`) were merged with the Lead's device findings. Authority order:
executed tests and device observation → source → docs. Every row names the responsible code path
and whether the gap was **fixed** (with evidence), **open** (registered as debt), or
**not a defect** (verified behaviour).

The product target was not "an APK that opens": it was the same meaning-first translator with
durable local data, a real Android lifecycle, correct system integration and a releasable artefact.

## P0 — data loss / total feature failure

| # | Gap | Evidence | Root cause | Status / evidence of fix |
| --- | --- | --- | --- | --- |
| P0-1 | **Android persistence was dead in 1.0.2.** Every `LinguaStore` call rejected with `"LinguaStore.then()" is not implemented on android`; sessions/settings/history never reached Room/DataStore. | logcat on first install at 18:17; Room `session_state={json:null,seq:0}`; A3-01, A6-01, A1 | Capacitor's plugin object is a Proxy whose fallback getter builds a method for *any* property, including `then`. `plugin.ts` returned it from an async function, so promise assimilation called `then()`. | **Fixed**: `asNonThenable()` wrapper in `src/lib/native/plugin.ts`; regression `plugin.test.ts`; device boot/history/session/saved verified. |
| P0-2 | **Drafts were never persisted even after the thenable fix.** Epoch-ms `seq` arrives as a JSON Long; `PluginCall.getDouble` rejects Long and returned null → seq=0 → `putSession` rejected every write. | A1 (Room copy showed `seq=0`, `json=null`), `LinguaStorePlugin.kt` | Wrong native decoder for a numeric DTO. | **Fixed**: `getLong("seq")` and `getLong("recentSince")`; repository rejects `seq<=0`; `BridgeInstrumentedTest` session round trip + stale-write test on API 35; draft survives force-stop on device. |
| P0-3 | **A degraded/timed-out boot could erase the phrasebook/memory.** The bridge had a 3 s timeout; the app then marked itself ready with empty caches and native writes enabled, so the next save did `DELETE + insert` from RAM. | A3-02, A2-02 | "Not hydrated" was indistinguishable from "empty". | **Fixed**: native reads/writes fail closed until `hydrate()` completes; settings writes gated on `setNativeSettingsReady(true)`; degraded boot reports storage unavailable. |
| P0-4 | **Every native cold start threw React hydration error #418** and discarded the prerendered shell. | logcat 18:17; A6-02 | Native prerender was the translator while the client's first render is the boot cover. | **Fixed**: `VITE_NATIVE_SHELL` define + cover prerender in `vite.native.config.ts`/`__root.tsx`; rebuilt APK logcat clean; native `index.html` contains `data-boot-cover="native"`. |

## P1 — core function, integrity or release blockers

| # | Gap | Evidence | Status |
| --- | --- | --- | --- |
| P1-1 | Release build silently fell back to the debug key. | A5-02, A7, TD18 | **Fixed**: release signing fails closed and requires `-PallowDebugSigning=true` for a warned review build; guard executed. The review APK is still debug-signed (no keystore) → TD18 open. |
| P1-2 | Native `repair`/`lexicon`/`shadow` buffered unbounded JSON before validation/admission. | A5-01 | **Fixed**: `boundedJson`/`parseAdmittedJson`; `handlers.server.test.ts` (oversized → 400, no token). |
| P1-3 | Backup import decoded UTF-8 per 1 MiB buffer; a split multi-byte Arabic/German character corrupted a valid file and the digest refused it. | A5-03, A3-17 | **Fixed**: `BackupReader.kt` single bounded decode + `BackupReaderTest` (every split point); SAF round trip verified on device. |
| P1-4 | Dictation could never start: Manifest lacked `MODIFY_AUDIO_SETTINGS`, which Capacitor requests with `RECORD_AUDIO`. | A2-01 | **Fixed**: permission added; Android microphone prompt and denial copy observed on device. Full transcription remains TD28 (emulator audio HAL). |
| P1-5 | Native TTS fallback repeated the thenable-proxy bug; `onFail` never ran. | A2-04 | **Fixed**: `src/lib/native/tts.ts` uses `asNonThenable` + guarded call; logcat shows the plugin reaching Google TTS. A failed voice is still silent (TD23). |
| P1-6 | Saved theme/locale/intro were only applied on the bridge-failure branch; every Android cold start used the default theme and could replay the intro. | A4-01, A3-09, A1 | **Fixed**: `applyStoredAppearance()` on the success path; device: light and vivid themes restored after force-stop, intro not replayed. |
| P1-7 | Import replaced Room/DataStore but left module caches stale; the next phrasebook/memory save rewrote imported data from RAM. | A3-03 | **Fixed**: `rehydrateDeviceData()` after import; device: full restore after `pm clear` (history, saved, memory, session, theme) verified. |
| P1-8 | Bridge operations were independent IO coroutines; whole-document writes and imports could interleave. | A3-04 | **Fixed**: one `Mutex` serialises every plugin operation. Stress/race test not written (source + serialisation rule). |
| P1-9 | Back with a language/model/voice sheet open closed the sheet **and exited**; back was dead on `/stats` and `/privacy`. | A4-03, A2 | **Fixed**: cancelable `lingua:back` + `dispatchBack()` + `useAndroidBack`; device: sheet→close (app stays), next back exits, `/stats` → translator with draft. |
| P1-10 | Keyboard-open stage detection could never fire on Android (`visualViewport` and `innerHeight` shrink together). | A4-04 | **Fixed**: native Keyboard plugin listeners drive `kbUp`; device: stage class flips, composer/result visible above the keyboard. |
| P1-11 | System bars and the window strip did not follow the app theme; light/vivid users saw black bars. | A4-06 | **Fixed**: `LinguaChrome` plugin paints the native window background from the canvas colour, re-applied after splash/theme; screenshots verify light and vivid. |
| P1-12 | Build not reproducible on an Arabic-locale host (Room KSP digits). | A7-06, Lead | **Fixed**: locale flags in `android/gradle.properties`; clean `:app` build verified. |
| P1-13 | Release was never device-tested; it is R8-shrunk and different from debug. | A7-03 | **Fixed** for the review APK: installed clean, first-run intro, German→Arabic translation, restart restore. No hardware test. |
| P1-14 | One-shot placeholder instrumented test asserted the wrong package id, so instrumentation could never pass. | A7-02, TD20 | **Fixed**: placeholders removed; 3 real bridge tests pass on API 35. |
| P1-15 | Migration test was thin (history only, hand-built v1, bypassed production `open()`). | A7-04, A3-13 | **Fixed**: history+saved+session rows, production `open()`, and a missing-migration test that fails loudly without deleting rows. |

## P2 / P3 — open, registered, deliberately not rushed

| # | Gap | Debt | Why not fixed now |
| --- | --- | --- | --- |
| P2-1 | API 24–29, OEM keyboards, physical devices and foldables not available. | TD17, TD21 | Environment limitation; the API 35 emulator matrix is complete and recorded. |
| P2-2 | IME legacy SystemBars branch still pads on API < 30; only API 35/WebView 124 verified. | TD21 | Needs an API 29 image/device; the 1.0.2 fix only covers the ≥140 branch. |
| P2-3 | Android CI job added but never executed on GitHub. | TD24 | Cannot run GitHub Actions from this environment; local gates are green. |
| P2-4 | Performance: 400-row boot window, whole-table memory writes, stats full-archive passes, per-word filter animation, default voice prefetch. | TD25 | Needs a physical-device profile before changing behaviour; emulator GPU is SwiftShader. |
| P2-5 | Corrupt DB/DataStore has no in-app recovery/export path. | TD26 | Real gap; a recovery flow must be designed so it cannot itself delete data. |
| P2-6 | Real dictation transcription unverified (emulator cannot record). | TD28 | Needs a physical microphone. |
| P3-1 | UI polish backlog: clear-button overlap in mixed direction, quiet error beside a kept result, splash/icon bitmap sizes, touch targets, Arabic letter-spacing, focus ring, placeholder contrast, `vh` in SavedSheet, no Android share target. | TD29 | Product-design work; none blocks data integrity. |
| P3-2 | TTS failure is not surfaced. | TD23 | Copy/state design; low risk but visible. |
| P3-3 | Mic-denied copy says "browser settings" in the APK. | TD22 | One string branch; queued with TD23. |
| P3-4 | Plain backups are not tamper-proof (unkeyed digest). | Docs corrected | Users are told "damaged", not "tampered"; encryption is available. |
| P3-5 | Web export has no 8 MiB cap like Android import. | TD27 | Edge case; needs a UX decision. |
| P3-6 | Unused Capacitor Clipboard plugin registered. | A5-19 (P3) | No data/privacy impact; removing it touches package/config and was not worth the regression risk in this pass. |

## Cross-check with the audit reports

| Report | Main independent findings | Reconciliation |
| --- | --- | --- |
| `01-architecture.md` | thenable persistence, seq Long decode, appearance, dictation, import report | confirmed on device; all fixed except docs/secondary items |
| `02-native.md` | dictation permission, degraded boot, IME legacy branch, native TTS, back/bars | fixed: permission, boot, TTS, back, bars; TD21 remains |
| `03-data.md` | P0 thenable + degraded boot, import caches, bridge ordering, import report/meta, seq guard, appearance | all fixed except corrupt-store recovery (TD26) and some P3 semantics |
| `04-ux.md` | appearance, back, keyboard, bars, mixed-direction controls, error visibility, icons | main four fixed; polish list in TD29 |
| `05-security.md` | unbounded native bodies, signing fallback, UTF-8 split, privacy copy, CORS tests, voice-on-background, TD19 | fixed; ADR 0008 closes TD19; share-target/stronger CSP follow-ups noted |
| `06-performance.md` | hydration/prerender, boot payload, write amplification, animation/filters, voice prefetch | hydration fixed and measured; performance backlog is TD25 |
| `07-qa-release.md` | no Android CI, broken instrumented test, release untested, migration thin, docs/hashes stale | fixed the tests/device verification and hashes; CI authored (TD24) |

## Verdict and remaining risk

There is **no known P0/P1 data-loss or feature-disabled defect left in the code paths exercised on
API 35.** The remaining release risk is concentrated in (a) hardware/API coverage that this
environment cannot provide, (b) the absence of a production signing key (TD18), and (c) performance
and polish that need a real device. Those are stated in the release report rather than hidden.

# A2 — Architecture & repository intelligence audit (Android)

Status: **complete (read-only audit)** · task: `task-1` (A1) · auditor: `arch`
Date: 2026-11-16 18:14–18:30 CET · Repo: `deep-meaning-translate` · Branch `main` ·
Audit basis: **commit `c897209`** ("Fix the Android 10 keyboard resize…"), package 1.0.2.

Concurrency note (read at 18:34, after this report's first draft): the working tree is
being actively changed by two other workstreams while the audit ran — the device/QA fixes
(`src/lib/native/plugin.ts` thenable proxy, `src/routes/__root.tsx` + `vite.native.config.ts`
`VITE_NATIVE_SHELL` hydration cover, new instrumented bridge test, Gradle locale flags,
`MigrationTest.kt`) and a persistence workstream (`LinguaStorePlugin.kt` operations mutex +
`boot().sessionSeq`, `LinguaRepository.kt` rollback/import fixes, `Daos.kt`,
`src/lib/persistence/native.ts` `hydrated` gate + seq seeding, `settings.ts` `nativeReady`
gate, `src/lib/native/handlers.server.ts` bounded JSON, new `BackupReader.kt` and bridge
tests). Every finding below is stated against **commit `c897209`**; line numbers are that
commit unless marked "(working tree)". Interaction notes:

- A2-01 is **not fixed** by the in-flight work: `sessionSeq` seeding (A3-06) only carries the
  stored stamp into JS; `call.getDouble("seq")` still returns `null` for a `Long` and still
  falls back to `0L` in the working tree (`LinguaStorePlugin.kt:144`), so every real stamp is
  still read as 0.
- A2-02/A2-03 are untouched by the in-flight edits.
- In the working tree, `settings.ts` now blocks writes until `setNativeSettingsReady(true)`,
  but no file in the tree calls that function yet (`platform.ts` is unmodified): until the
  boot wiring lands, native settings writes fail closed. This is transient integration risk
  for the lead, not a finding against `c897209`.

Classification used: VERIFIED (source inspection / executed command confirms), OBSERVED
(seen in a running artifact/device data), SUSPECTED (plausible, not confirmed),
NOT_VERIFIED (could not be exercised here). See `docs/quality/testing.md:48-59`.

---

## 1. Summary verdict

The Android architecture is **structurally sound and honest about its boundaries**: one SPA,
one prompt/engine set, a `PersistencePort` with web/native adapters chosen once at boot, a
typed Kotlin bridge (Room records + Preferences DataStore settings), SAF files, a native TTS
fallback, and a versioned `/api/native/v1/*` surface that _is deployed and gated_ (live-probed
below). Route coverage of the documented native surface is complete (7/7), and no dual-write
of records was found.

It is **not ready for a stable daily-use release**, because the layer between TypeScript and
Kotlin breaks in ways the web gates cannot see:

1. **P0 — the session/draft is never persisted on Android.** The bridge sends `seq` as a JS
   number (epoch ms); Capacitor's `PluginCall.getDouble` only accepts `Double/Float/Integer`
   and returns `null` for a JSON `Long`, so Kotlin falls back to `seq = 0`; the repository's
   monotonic guard then rejects every subsequent session write
   (`LinguaStorePlugin.kt:132`, `PluginCall.java:238-254`, `LinguaRepository.kt:76-87`).
   The failure is silent (`saveSession` return value ignored). I read the installed app's
   database: `session_state = {json: null, seq: 0}` — exactly the fallback.
2. **P1 — the native boot never applies the stored appearance.** `applyStoredAppearance()`
   (theme, locale/direction, intro gate) is called **only in the degraded catch branch**
   (`platform.ts:86-95`); the three pre-paint boot scripts read `localStorage`, which the
   native adapter never writes (settings live in DataStore). On the emulator the WebView
   localStorage is empty while DataStore holds `lingua.intro.seen.v1`, `lingua.prefs.v1`,
   `lingua.voice.v2`. Consequence: saved theme ignored, Arabic UI first paint LTR, and the
   first-run intro gate is permanently "open" — the intro reappears whenever no draft exists.
3. **P1 — dictation cannot receive the microphone.** The merged manifest lacks
   `MODIFY_AUDIO_SETTINGS`, which Capacitor's `BridgeWebChromeClient` requests together with
   `RECORD_AUDIO` and denies if _any_ requested permission is not granted
   (`BridgeWebChromeClient.java:102-123`, `AndroidManifest.xml:9-11`).

Secondary architecture debt: the native enrichment handlers are a **second implementation**
of the web server functions (docs claim the opposite), the Android import report/metadata is
wrong and not recorded, "forget everything" leaves settings caches alive in RAM, and several
load-bearing documents describe a different implementation than the code.

---

## 2. Current state — the real flow (startup → restore → translate → settle → background → resume → exit)

Each step is the executed path in commit `c897209`; deviations are marked **⚠**.

**Boot**

1. Native splash with `launchAutoHide: true`, 6 s ceiling (`capacitor.config.ts:28-36`) covers
   the WebView. The APK serves the SPA from `assets/public` at origin `https://localhost`.
2. Document head runs `THEME_BOOT`, `LOCALE_BOOT`, `INTRO_BOOT`, `BOOT_GUARD_SCRIPT`
   (`src/routes/__root.tsx:84-88`). All three state scripts read `localStorage`
   (`theme.ts:30`, `i18n.ts:612`, `intro.ts:24`). **⚠ A2-02**: native settings are in
   DataStore, never in localStorage, so these scripts see nothing.
3. React mounts; the root gate holds a boot cover until `platformReadySync()`
   (`__root.tsx:104-136`, `platform.ts:48-50`). Hydration is safe because the native shell
   prerenders the cover (working-tree `VITE_NATIVE_SHELL`, not yet committed).
4. `hydratePlatform()` switches settings to native mode and awaits
   `nativePort.hydrate()` with a 3 s timeout — one `LinguaStore.boot` round trip returning
   validated settings, prefs, session, the 400 newest history rows + total, saved, memory
   (`platform.ts:71-101`, `persistence/native.ts:51-70`, `LinguaStorePlugin.kt:84-103`,
   `LinguaRepository.kt:36-48`). Each store then receives its hydration call.
   **⚠ A2-02**: the success branch returns without `applyStoredAppearance()`.
5. Ready → `finishPlatformChrome()` waits two animation frames, sets status-bar icon style
   from `documentElement.dataset.theme`, hides the splash (one retry) (`platform.ts:108-138`,
   `__root.tsx:114-118`).

**Restore** 6. The translator's first render is seeded synchronously from `persist.remembered()`
(`index.tsx:156-164`), which the boot hydration filled. Its mount effect
(`index.tsx:235-306`) calls `initLocale()` (line 238 — **after first paint**),
applies prefs, then forks: shared text / pending stats pick / request durable + SW
(SW is a no-op in the APK, `pwa.ts:30-37`) / saved session. 7. Saved-session branch: `restorePlan(session, prefs)` (pure, `translation/restore.ts:35-47`)
keeps the **session** pair and style, fills dialect/brain from prefs; the cached result is
primed under the request key and `submitNext()` lets the scheduler find it without a new
request (`index.tsx:277-298`, `useTranslator.ts:126,452-455,512-531`). 8. Intro decision: `wantsIntro = !pick && !shared && !session?.text && introPending()`
(`index.tsx:261`). `introPending()` reads the pre-paint attribute (`intro.ts:27-29`), not
the device value. **⚠ A2-02**: with empty localStorage the attribute is always set, so the
intro is shown again on every native launch whose draft is empty, even after
`lingua.intro.seen.v1 = 1` was stored. 9. After restore: `savePrefs` (`index.tsx:308-310`, persists — DataStore holds
`lingua.prefs.v1`); session saved on a 400 ms debounce and on
`visibilitychange`/`pagehide`/`lingua:flush` (`index.tsx:314-339`).
**⚠ A2-01: every one of these session writes is rejected after the mount-time null save.**

**Translate** 10. Request identity is defined once (`translationKey`/`keyOf`, `useTranslator.ts:62-80`).
The scheduler decides _when_ (`translation/scheduler.ts:60-81`) and `streamTranslate`
POSTs to `/api/translate-stream` — or the native base in the app, i.e.
`nativeApiUrl("/api/native/v1/translate-stream")` (`translation/stream.ts:5-28`,
`native/config.ts:44-55`). The packaged bundle references **all seven** native paths
(verified by grepping the built assets). 11. The Worker applies `nativeEndpoint` (exact origin allowlist + CORS) and the shared
`handleTranslateStream` (`native/gate.server.ts:83-96`,
`routes/api/native/v1/translate-stream.ts:6-15`, `translation/streamRoute.server.ts:32-151`).
Live vs settled use separate budgets (`takeLiveToken`/`takeToken`). 12. Enrichment: repair/lexicon/shadow/dictation go through `native/rpc.ts:14-89` to
`/api/native/v1/{repair,lexicon,shadow,dictation-token}`; web uses TanStack server
functions. **⚠ A2-04**: the native handlers are copies of the web handler bodies
(`native/handlers.server.ts:19-144` vs `*.functions.ts`), not shared code.
**⚠ A5-01** (other report): these three handlers parse `request.json()` unbounded.

**Settle** 13. Full mode: parse → verify → commit → `handleSuccess` archives only settled results
(`useTranslator.ts:326-374`, `index.tsx:184-206` → `history.add`). Native merge uses a
Room candidate query, then upsert+delete+trim (`history.ts:141-208`, `Daos.kt:42-47`).
Settled results are written to device memory (`useTranslator.ts:341-374`) — the emulator
DB contains memory rows, one of them a same-language echo (see A2-11 note). 14. Quiet repair only if deterministic issues exist or Luna is enabled (it is not:
`LUNA_ENABLED = false` in `types.ts`, `streamRoute.server.ts:82-91`). 15. `ResultPanel` stops speech on text change/unmount and prefetches cloud voice
(`ResultPanel.tsx:137-165`).

**Background** 16. `visibilitychange` and Capacitor `appStateChange` dispatch `lingua:flush` and call
`flushPlatform()` (`platform.ts:150-175`); the translator saves the session snapshot and
flushes settings (`index.tsx:322-339`). **⚠ A2-01**: the session save is rejected;
**⚠ A5-06**: nothing stops voice/recording; the stream is aborted only when the
component unmounts or a newer request supersedes it.

**Resume / exit** 17. Returning to foreground does not re-run boot; in-memory state is reused (root shell never
unmounts; translator remounts only across routes). A process death re-runs step 4, so
resume fidelity depends on A2-01 (currently broken). 18. Android back arrives via `App.addListener("backButton")` → `lingua:back`
(`platform.ts:166-170`); the handler closes sheet → intro → blurs a field → router back
if not on `/` → `App.exitApp()` (`index.tsx:661-699`). This matches the documented
order (`docs/android/architecture.md:82-95`), except "dismiss keyboard" is implemented
as _blur the focused element_ and "history available" is inferred from
`window.location.pathname` only (SUSPECTED edge: a deep-linked secondary route with no
history entry leaves back inert).

**One-source-of-truth assessment**

- Records (history/saved/memory/session): Room only on Android — verified: the native port
  never calls the web store; the web adapter is only imported for its types/validators
  (`history.ts:11`, `saved.ts:10`, `translation/memory.ts:10`). No dual write found.
- Settings/prefs: DataStore only on Android (`settings.ts:73-126`) plus the `prefsWrite`
  path (`LinguaRepository.kt:64-69`). Correct — **but the boot scripts and
  `applyStoredAppearance` are the only readers that do not use this store (A2-02)**.
- Prompts/engine: single definitions; web and native transports share the translate/speech
  handlers but not the enrichment orchestration (A2-04).
- Stats: derived from the archive; the translator holds only the 400-row window and
  `/stats` loads all rows through `history.all()` (`useArchive.ts:16-31`) — by design,
  one redundant full-archive read per mount.
- Clear path: `clearDeviceData()` is the single listed path, but incomplete (A2-06).

---

## 3. Findings table

| ID        | Severity | Area                                       | Evidence (path:line @ c897209)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Impact                                                                                                                                                                                                                                                                                                                                                                                             | Root cause                                                                                                                                                                                         | Proposed fix                                                                                                                                                                                                                                                                               | Regression test                                                                                                                                                                                                                                                   |
| --------- | -------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A2-01** | **P0**   | Data loss / bridge DTO                     | `src/lib/persistence/native.ts:30-34,81-88` (sends `seq = Date.now()`); `LinguaStorePlugin.kt:131-134` (`call.getDouble("seq") ?: 0L`); `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/PluginCall.java:238-254` (getDouble ignores `Long`); `LinguaRepository.kt:76-87` (`seq <= current.seq` → reject); `src/routes/index.tsx:319,325-330` and `persist.ts:75-80` (return ignored). **OBSERVED**: emulator `lingua.db` `session_state = {json:null, seq:0, updated_at:1794849607556}` (read-only copy 18:22)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The current draft/translation session is never persisted: the mount-time null session is written with seq 0, and every later write is rejected; a force-stop/reopen restores nothing (or an older partial draft). Silent — no UI signal. Breaks the core continuity promise (`docs/android/architecture.md:46-57`, `device-compatibility.md:26,52`)                                                | JS number >2^31 is decoded by a `getDouble` helper that returns the default for `Long`; the fallback `0L` makes the monotonic guard self-defeating                                                 | Decode with `call.getLong("seq")` (same for `recentSince`); ideally move the whole DTO to a string/integer tick to avoid the number-type trap. Return/consume the `ok` flag and surface write failure                                                                                      | Kotlin unit test for the decode helper with a JSON body whose `seq` is `Long`; instrumented (TD20) bridge test `sessionWrite` twice and read `boot().session`; device step: type draft → `adb shell am force-stop` → relaunch → draft returns                     |
| **A2-02** | **P1**   | Native boot / state restore                | `src/lib/platform.ts:56-69` (the function), `platform.ts:79-95` (called only in `catch`); `src/lib/theme.ts:30`, `src/lib/i18n.ts:612`, `src/lib/intro.ts:24` (boot scripts read `localStorage`); `src/lib/persistence/settings.ts:45-54,73-86` (native read/write = DataStore snapshot, never localStorage); `src/styles.css:893` (intro CSS gate); `src/routes/index.tsx:238,261,299-304`. **OBSERVED**: emulator WebView `Local Storage/leveldb` empty (0-byte log, no `lingua` keys) while DataStore holds `lingua.intro.seen.v1`, `lingua.prefs.v1`, `lingua.voice.v2`                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Saved theme is ignored on every cold start; interface locale/direction is wrong for the first painted frames (Arabic user sees LTR English, then flips); the intro gate is always "open", so the first-run overlay returns on any launch with no saved draft; status-bar icon style follows the wrong theme. Contradicts docs claiming the splash is held until the restored appearance is painted | The native success path forgot the appearance step it takes in the degraded path; the pre-paint scripts are web-only and were never adapted to DataStore (only readable after the bridge snapshot) | Apply the stored appearance unconditionally after a successful hydrate, before `ready = true` (theme, locale/dir, intro gate, `syncThemeColor`), then hide the splash; keep the boot script as the web fallback. Add a unit test asserting the success path applies theme/locale/attribute | `platform.test.ts`: hydrate resolves a snapshot with theme=light, locale=ar, intro=1 → after ready, `dataset.theme`/class, `documentElement.dir`, and absence of `data-intro`; device: set light + Arabic UI, force-stop, relaunch, screenshot before interaction |
| **A2-03** | **P1**   | Dictation permission                       | `android/app/src/main/AndroidManifest.xml:9-11` (INTERNET, RECORD_AUDIO only); merged release manifest `android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml:16-17`; `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java:102-123` (requests `MODIFY_AUDIO_SETTINGS` + `RECORD_AUDIO` for `AUDIO_CAPTURE`); same file `:58-64` (grant only if **all** requested permissions are granted); `src/lib/useAssemblySpeech.ts:36-45`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Tapping the mic fails for every Android user: `getUserMedia` is denied because the undeclared normal permission cannot be granted, so the whole dictation feature is dead. Documented as working (`docs/android/network-and-security.md:56-58`, `device-compatibility.md:31`)                                                                                                                      | The Capacitor WebView audio-capture contract was not mirrored in the manifest; only RECORD_AUDIO was added                                                                                         | Add `<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS"/>`; verify the merged manifest; confirm the permission callback grants                                                                                                                                       | Manifest assertion in CI (`aapt2 dump xmltree`/Gradle) for both permissions; instrumented permission test; device mic smoke test (grant → record → transcript)                                                                                                    |
| **A2-04** | P2       | Native API architecture                    | `src/lib/native/handlers.server.ts:19-43` (repair) vs `src/lib/translation/translate.functions.ts:65-89`; `:45-64` (lexicon) vs `lexicon.functions.ts:16-38`; `:67-97` (shadow) vs `shadow.functions.ts:18-43`; `:100-144` (dictation) vs `assembly.functions.ts:6-53`. Docs claim "Each native route reuses the web handler… no second implementation" (`docs/android/network-and-security.md:20-22`, ADR 0007:13-16)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Four of seven native capabilities are copy-pasted orchestration: a fix (auth rule, bounds, logging, cache) lands in one copy only. First divergence already exists: native handlers read unbounded JSON (A5-01), web handlers use `parseAdmittedJson`                                                                                                                                              | Server-function bodies were wrapped by transport, not refactored into a shared domain layer; only speech/translate were extracted                                                                  | Extract the four bodies into shared functions taking an `authorize` callback (the `speechRoute.server.ts` pattern used by `speak.ts` vs `native/v1/speak.ts`) and make both surfaces thin wrappers; fold the A5-01 bounded-body fix into that change                                       | Unit tests on the shared functions with both authorize strategies; a static repo check that native routes import the shared handler, plus the existing route tests                                                                                                |
| **A2-05** | P2       | Backup import integrity                    | `src/lib/persistence/native.ts:161-176` (`return applied ?? report`; only `{json, mode}` sent); `LinguaRepository.kt:229-245` (`added` = dataset sizes, `skipped` always 0, `replaced` always true); `LinguaStorePlugin.kt:224-234` accepts `fileName`/`digest` but TS never sends them; `src/components/DataControls.tsx:397-410` (renders added/skipped); docs `docs/android/data-import-export.md:61-65`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | On Android a **merge** import reports "N added · 0 already present" where N is the post-merge row count, and "replace" style counts for a merge; `import_meta.fileName/digest` are always NULL, so the documented audit trail does not exist. Users cannot tell whether a merge duplicated anything                                                                                                | Kotlin cannot compute the TS add/skip diff, but the native adapter prefers the Kotlin report; the file name/digest were dropped from the DTO                                                       | Pass `fileName`/`digest` from DataControls → port → plugin; return the TS-computed `report` for merge (and use Kotlin's only for replace), or have Kotlin return row counts and diff in TS. Record the real metadata                                                                       | Extend `persistence.test.ts`/DataControls test: merge reports the merged diff and replace reports totals; Kotlin RepositoryTest asserts `import_meta` has fileName/digest/mode; device SAF import/export round-trip                                               |
| **A2-06** | P2       | "Forget everything" integrity              | `src/lib/clearData.ts:15-22` (resets saved/history/memory/prefs/settings snapshot only); `src/lib/voice/prefs.ts:49-71` (module `current` cache survives; `setVoicePrefs` re-writes it); `src/lib/feel/prefs.ts:31-63` (`resetFeelPrefs` exists but is called only by tests — verified by grep); `src/routes/stats.tsx:294-297` (fires and forgets); UI promise `src/lib/stats/labels.ts:164-165`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The UI says "removes all translations, saved phrases and settings", but after clearing, voice/feel/theme/locale state stays alive in RAM; opening the voice/feel controls and toggling anything writes the old values back into DataStore. Privacy/contract violation and a resurrection path for "deleted" settings                                                                               | The clear path was extended with history/saved/memory caches but the settings modules never registered reset hooks; `forgetSettingsCache` clears the adapter map, not the consumer caches          | Add `resetVoicePrefs()`/`resetFeelPrefs()` and reset theme/locale/intro module state inside `clearDeviceData()` (or make those stores read the adapter on reset); call `clearDeviceData()` with `await` and reload/gate after it                                                           | Extend `clearData.test.ts`: set voice/feel/theme prefs → clear → reads return defaults and a later voice toggle does not write the old map; native variant with a fake bridge                                                                                     |
| **A2-07** | P2       | Voice fallback (SUSPECTED runtime)         | `src/lib/tts.ts:137-165` (native TTS only when `speechSynthesis`/`SpeechSynthesisUtterance` absent); `:240-260` (watchdog fails with "blocked"/"novoice"); `src/lib/native/tts.ts:12-31,40-86` (LinguaTts path); docs claim the fallback (`docs/android/architecture.md:104`, `device-compatibility.md:30`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Android System WebView is Chromium and may expose `speechSynthesis` with no usable voices; the code then fails in the Web Speech path and never tries the Android engine, so Listen can be silent although the fallback exists. NOT tested on the device here                                                                                                                                      | The fallback gate tests _capability presence_, not _working audio_; the failure path reports instead of falling back                                                                               | On device-path failure (`onFail`) in the installed app, try `hasNativeVoice()` once from the same position before reporting failure; keep a guard against loops                                                                                                                            | `tts.test.ts` with a fake `speechSynthesis` that never starts/ends → asserts `speakNative` is called once; device Listen smoke test                                                                                                                               |
| **A2-08** | P2       | Docs vs code (load-bearing)                | Backup envelope: `docs/android/data-import-export.md:10-38` says `payload`/`exportedAt`/`ciphertext`, code has `data`/`createdAt`/`cipher.text` (`persistence/backup.ts:121-146,245-263`), digest is over `data` not "payload"; "merge matched by id" (doc:57) vs `target+normalized` (`backup.ts:251-307`); "DataStore keeps one Preferences key containing a JSON object" (`docs/android/persistence-and-migrations.md:85-89`) vs one key per setting (`SettingsStore.kt:17-45`); "clearAll … inside a transaction. The app then reloads" (`persistence-and-migrations.md:97-100`) vs Room tx + separate DataStore edit, no reload (`LinguaRepository.kt:249-257`, `clearData.ts`); `launchAutoHide: false` (`docs/android/architecture.md:49`) vs `true` (`capacitor.config.ts:32`); AGENTS "the other model is the automatic fallback" (`AGENTS.md:71`) vs `LUNA_ENABLED=false` (`types.ts`, `docs/architecture/api-and-providers.md:43-50`); `PROJECT_MAP.md:86` "~1,060 lines" vs current 1,145 (`src/routes/index.tsx`) | External tools/tests written against the documented backup format will not import; the knowledge base cannot be trusted where it matters most (format, transactions, boot guarantees). Violates the AGENTS authority order (`AGENTS.md:30-32`)                                                                                                                                                     | Android docs were written from intent rather than the final code, and not re-verified after the last refactor                                                                                      | Correct the documents whose **Scope** covers each change per the AGENTS workflow; treat the code as evidence (`AGENTS.md:54-56`)                                                                                                                                                           | `npm run check:docs` (links/inventory) plus a doc-vs-code test for the backup envelope keys (round-trip a fixture in `persistence.test.ts`)                                                                                                                       |
| **A2-09** | P3       | Bridge DTO (same class as A2-01)           | `LinguaStorePlugin.kt:146-155` (`call.getDouble("recentSince") ?: 0L`); `Daos.kt:42-47`; TS `historyCandidates` (`history.ts:82-95`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | The DAO's "recent window" is always satisfied (`updated_at >= 0`), so every candidate query returns the latest 50 rows per target. Merge correctness is preserved by the TS prefix re-check, but the query semantics and cost differ from the docs                                                                                                                                                 | Same numeric-type trap as A2-01                                                                                                                                                                    | Use `call.getLong("recentSince")` in the A2-01 change; add a shared "numeric bridge args" note to the bridge docs                                                                                                                                                                          | RepositoryTest calling the Kotlin decode with a Long; existing `candidates` test stays green                                                                                                                                                                      |
| **A2-10** | P3       | Dead/duplicated code & build hygiene       | `src/lib/pwa.ts:30-37` (identical `isNativeApp` guard twice); `src/lib/native/plugin.ts:70-96` (`LinguaTts` registration/interface) vs `src/lib/native/tts.ts:12-31` (a second registration of the same plugin name); `android/app/src/main/assets/public` is untracked and only refreshed by `npx cap sync` — no gate compares it with `android-web/` (I observed a stale hashed entry bundle next to the newly built one in `android-web/assets` during the rebuild); `src/routes/lab.tsx` is bundled but 404s in release                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Duplicated registrations can drift; a build that skips `cap sync` can package an older UI while all gates pass (the APK is the only artifact users get). Low direct impact today                                                                                                                                                                                                                   | Template/duplicate removal never done; packaging relies on a human step documented in `build-and-release.md`                                                                                       | Single typed handle per Capacitor plugin; remove the duplicate guard; add a build script/check that asserts `assets/public/index.html` references an asset present in the APK and matches `android-web` hashes                                                                             | `scripts/check-native-assets.mjs` (hash compare) run in the Android job; unit test for the single plugin handle                                                                                                                                                   |
| **A2-11** | P3       | Translation memory data hygiene (OBSERVED) | Emulator `memory_rows` contains a cache key for `auto → de` whose stored payload is the source text itself with `targetLanguage: "de"` (same-language identity payload) (`targetLanguage: "de"`, `translation` = input); code writes memory inside `run()` (`useTranslator.ts:341-350`) before the component decides the result is a re-route (`index.tsx:341-352`), while history is correctly refused for the same case (`index.tsx:187`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Identity/irrelevant rows accumulate in device memory (bounded, TTL, but junk); a future key collision could replay an echo as a settled answer                                                                                                                                                                                                                                                     | Memory persistence sits in the transport hook, below the product rule that only a real direction change is a translation                                                                           | Move the "real settled translation for a different target" check into `useTranslator`'s commit path (shared with history), or have `memorySet` refuse results whose `sourceLanguage` and `targetLanguage` match                                                                            | `useTranslator.test.tsx`/memory test: a same-language echo is committed for display/reroute but never stored in memory; history test already covers the archive                                                                                                   |

---

## 4. Detailed notes on the three release blockers

### A2-01 — session write path (P0)

- TypeScript: `seq: nextSeq()` where `nextSeq = Math.max(seq + 1, Date.now())`
  (`src/lib/persistence/native.ts:30-34,81-88`). JSON over the bridge therefore contains an
  integer `1794…` (a `Long` once parsed by `org.json` on the native side).
- Capacitor: `PluginCall.getDouble` accepts only `Double|Float|Integer` and returns the
  default otherwise (`PluginCall.java:238-254`); `getLong` exists and handles `Long`
  (`PluginCall.java:191-208`).
- Kotlin: `val seq = call.getDouble("seq")?.toLong() ?: 0L`
  (`LinguaStorePlugin.kt:131-134`); `putSession` rejects `seq <= current.seq`
  (`LinguaRepository.kt:76-87`). First write (at mount, empty draft) stores `json=null,
seq=0`; all later writes are rejected.
- Evidence it is real, not theoretical: the installed debug build's database on
  `emulator-5554` (read-only copy via `run-as cat`, 18:22) contains exactly that row:
  `session_state = {id:1, json:null, seq:0, updated_at:1794849607556}`, while history and
  memory rows _were_ written by the same session — so the bridge works and only the session
  DTO decode fails.
- Blast radius: draft text (the product's primary user input) and the restored translation;
  `docs/android/persistence-and-migrations.md:78-84` and the device checklist
  (`device-compatibility.md:52`) both promise this works. The failure is silent because
  `persist.saveSession` (`persist.ts:75-80`) and every caller ignore the boolean.
- Working-tree interaction: the in-flight persistence workstream seeds the JS stamp from
  `boot().sessionSeq` (working tree `src/lib/persistence/native.ts:74-78`,
  `LinguaRepository.kt:36-46`) to survive a clock rollback (A3-06). That is necessary but not
  sufficient: it does not change the decode, so with a real `Long` the Kotlin side still
  sees `0L` and the guard still rejects every write after the first. The decode fix below is
  still required.
- Fix + tests in the table. Also worth adding a single typed bridge-arg codec
  (string or `getLong`) so future numeric DTOs cannot regress.

### A2-02 — pre-paint state in the installed app (P1)

- The native architecture doc's boot diagram explicitly lists `applyStoredAppearance()`
  before the splash is hidden (`docs/android/architecture.md:46-57`) and the persistence doc
  describes the order "inline palette/dir script → bridge boot → caches → appearance → splash
  hidden → React render" (`docs/architecture/state-and-persistence.md:115-118`). The code
  calls it only when hydration throws (`platform.ts:86-95`).
- Because `readDeviceValue` for native mode reads the DataStore snapshot
  (`settings.ts:45-54`) and the inline scripts read `localStorage`
  (`theme.ts:30`, `i18n.ts:612`, `intro.ts:24`), the pre-paint scripts are dead code in
  the APK. Observed: WebView `Local Storage/leveldb` has a 0-byte log and no `lingua`
  entries, while DataStore contains `lingua.intro.seen.v1`, `lingua.prefs.v1`,
  `lingua.voice.v2`.
- The intro consequence is not only cosmetic: `introPending()` reads the HTML attribute
  (`intro.ts:27-29`), so with an always-open gate a returning user with an empty draft is
  shown the full first-run takeover again on every launch (the effect only hides it when a
  draft exists, leaving a one-frame flash in that case).
- Fix ordering matters: hydrate → apply appearance (theme class/dataset, `colorScheme`,
  locale + dir, `releaseIntroGate` when seen, `syncThemeColor`) → `ready = true` →
  `finishPlatformChrome` (status bar then reads the right `dataset.theme`).

### A2-03 — microphone permission (P1)

- Capacitor grants WebView `AUDIO_CAPTURE` only if **every** permission it requested is
  granted (`BridgeWebChromeClient.java:102-123`: requests `MODIFY_AUDIO_SETTINGS` and
  `RECORD_AUDIO`; `:58-64`: `granted = all`); an undeclared permission always reports
  denied, so the request is denied and `getUserMedia` rejects.
- Manifest declares only INTERNET + RECORD_AUDIO; the merged release manifest (built at
  18:18) confirms MODIFY_AUDIO_SETTINGS is absent. The mic feature therefore has **no
  execution path** on Android even though the TS/UI path exists end-to-end
  (`useAssemblySpeech.ts` → AssemblyAI token route → WebSocket).
- Note: the security team's merged-manifest review listed RECORD_AUDIO as sufficient; this
  is the missing piece. Add the permission (normal, no runtime dialog) and re-merge.

---

## 5. Verified vs unverified matrix

| Claim / area                                                                                                     | Classification                                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session persistence works on device                                                                              | **FAILED — VERIFIED by code + OBSERVED data** (A2-01)          | Code path above + `session_state.seq = 0` on emulator                                                                                                                                                                                                                                                                                                                                                                                        |
| Native boot applies saved theme/locale/intro before first paint                                                  | **FAILED — VERIFIED by code + OBSERVED storage state** (A2-02) | `platform.ts`, boot scripts, empty localStorage vs populated DataStore                                                                                                                                                                                                                                                                                                                                                                       |
| Dictation permission path works                                                                                  | **FAILED — VERIFIED by manifest + Capacitor source** (A2-03)   | Merged manifest lacks MODIFY_AUDIO_SETTINGS                                                                                                                                                                                                                                                                                                                                                                                                  |
| Native API surface matches docs                                                                                  | **VERIFIED (7/7 routes) / PARTIAL**                            | `src/routes/api/native/v1/*` 7 files; client references in the packaged bundle; live probes below. Architecture claim "no second implementation" is false (A2-04)                                                                                                                                                                                                                                                                            |
| Native endpoints deployed and origin-gated in production                                                         | **VERIFIED (live probes, read-only)**                          | `GET https://fluently.today/api/native/v1/translate-stream` + `Origin: https://localhost` → 204; `POST …/repair {}` allowed origins → 400 `{"ok":false,"kind":"input"}`; `https://evil.example`, `https://fluently.today`, no Origin → 403; preflight → 204 with exact-origin ACAO, `Vary: Origin`, allowed method/header list. NOTE: `http://localhost` and `capacitor://localhost` are also accepted in production — cross-ref A5-04/A5-05 |
| No dual write / one store per platform                                                                           | **VERIFIED (source)**                                          | Native adapter never touches localStorage; web adapter never loads in the APK; port chosen once (`persistence/index.ts:11`)                                                                                                                                                                                                                                                                                                                  |
| Room migration 1→2 additive and tested                                                                           | **VERIFIED (source/test present; not re-run)**                 | `LinguaDatabase.kt:49-72`, `MigrationTest.kt`, tracked `schemas/…/2.json`                                                                                                                                                                                                                                                                                                                                                                    |
| Import/export round-trip on Android reports correct counts/metadata                                              | **FAILED — VERIFIED by code** (A2-05)                          | Kotlin report overrides TS report; no fileName/digest                                                                                                                                                                                                                                                                                                                                                                                        |
| "Forget everything" removes every Lingua store                                                                   | **FAILED — VERIFIED by code** (A2-06)                          | `clearData.ts` + module caches                                                                                                                                                                                                                                                                                                                                                                                                               |
| Native device TTS fallback when WebView speech fails                                                             | **SUSPECTED**                                                  | Gate is capability-presence only (A2-07); needs device Listen test                                                                                                                                                                                                                                                                                                                                                                           |
| Background stops voice/recording                                                                                 | **FAILED — VERIFIED by code** (A5-06, cross-ref)               | No `stopSpeaking`/`speech.cancel` in the lifecycle path                                                                                                                                                                                                                                                                                                                                                                                      |
| Theme/locale/intro visually correct on device                                                                    | **NOT_VERIFIED**                                               | Requires interacting with the installed app; I stayed read-only                                                                                                                                                                                                                                                                                                                                                                              |
| Dictation transcript, SAF picker flow, native TTS audio, keyboard/IME resize, RTL layout, first-run intro visual | **NOT_VERIFIED**                                               | Device interaction checklist (`device-compatibility.md:44-57`) is owned by the lead/device workstream                                                                                                                                                                                                                                                                                                                                        |
| Web gates (`npm run verify`)                                                                                     | **NOT re-run by me** (lead baseline: exit 0 on 2026-11-16)     | Not part of this read-only audit; `check:docs` will fail once team reports are added (A7-16)                                                                                                                                                                                                                                                                                                                                                 |
| Tests/builds/APK signing                                                                                         | **NOT run by me**                                              | Lead built/installed centrally; I only read existing outputs                                                                                                                                                                                                                                                                                                                                                                                 |
| Translation quality/provider latency                                                                             | **NOT_VERIFIED**                                               | Out of scope (no keys / no provider requests)                                                                                                                                                                                                                                                                                                                                                                                                |

Read-only probes I performed: `git`/file reads; production HTTP probes above with empty or
warm-only bodies (no provider text, no paid request); `adb shell run-as … cat/ls` to copy the
installed app's own database/DataStore/WebView-storage files for inspection. I did not
install, launch, modify, or clear anything on the emulator.

---

## 6. Highest-priority actions (ordered)

1. **Fix the session bridge DTO (P0, A2-01).** `call.getLong("seq")` (and `recentSince`) or a
   string-encoded tick; consume `ok` and surface a failed save. Add the JVM decode test +
   instrumented bridge test, then verify on `emulator-5554`: type a draft → force-stop →
   relaunch → the same draft and translation return with no new translation request.
2. **Apply stored appearance before the first native frame (P1, A2-02).** Call
   `applyStoredAppearance()` on the successful hydrate path before `ready = true`; add the
   platform unit test and a device check for light theme + Arabic UI + no recurring intro.
3. **Restore dictation capability (P1, A2-03).** Add `MODIFY_AUDIO_SETTINGS`, verify the
   merged manifest, and run the mic flow on the emulator (permission prompt → speech →
   transcript).
4. **Fix import reporting/audit metadata and "forget everything" (P2, A2-05/A2-06).** Pass
   fileName/digest through the port; return the TS merge report (or a Kotlin diff); reset the
   voice/feel/theme/locale/intro module caches in `clearDeviceData()`; tests for both.
5. **Collapse the native handlers into shared domain functions (P2, A2-04) and fold in the
   bounded-body fix (A5-01).** One implementation per capability, authorize passed in; then
   correct the load-bearing docs (A2-08) in the same change per the AGENTS workflow.
6. **Keep the gates green after the audit.** The team reports under
   `docs/audits/android-team/` are not in `DOCUMENTATION_INDEX.md`, so `npm run check:docs`
   (and therefore `npm run verify`) fails until they are indexed (verified by QA: A7-16).
   Also add a build assertion that packaged `assets/public` matches `android-web` (A2-10).

---

## 7. Cross-references to the other team reports (avoid double counting)

- A5-01 unbounded native JSON, A5-03 backup UTF-8 chunk decoding, A5-06 background voice
  not stopped: covered in `docs/audits/android-team/05-security.md`; cited here only where
  they intersect the architecture (A2-04/A2-06/A2-07).
- A7-16 `check:docs` fails on unindexed audit reports: covered in
  `docs/audits/android-team/07-qa-release.md`; repeated only as a release-gate action.
- The working-tree `plugin.ts` thenable fix, the `__root.tsx`/`VITE_NATIVE_SHELL` hydration
  cover and the Gradle locale flags are in flight by the device-verification workstream; not
  counted as findings here (base `c897209` has the raw Capacitor plugin proxy, which is why
  the first device runs saw "silently lost" persistence).

_End of report._

# Android Release Report — 1.0.8

Date: 2026-11-16 · Build: `versionCode 9`, `versionName 1.0.8` · Base commit `c897209`.

## 1.0.8 — translation-freeze hotfix (why 1.0.3 was replaced)

The 1.0.3 APK could leave the result area on a skeleton forever — a person typed a short
German word (or any text whose translation equalled the input) while the target chip said
**Deutsch**, and no result or error ever appeared. The cause was in the route's re-route
guard, not in the provider: a **provisional** live result carries `sourceLanguage: "auto"`,
and the old rule also treated “translation text equals input text” as “the screen is about
to re-route”. Since the auto-flip effect only fires when a _detected_ source equals the
target, nothing flipped the target and the skeleton never cleared.

1.0.8 fixes it in two ways:

- `shouldHoldForReroute()` (`src/lib/translation/echo.ts`) holds only a **settled** result
  whose `sourceLanguage` explicitly equals the target; a provisional result can never freeze
  the screen. Regression tests cover the exact “Hallo / Deutsch / auto” case.
- A detected echo (translation normalized-equals the input, ignoring case and trailing
  punctuation) tries the other half of the Arabic/German pair once, and an echo is never
  archived as a history row. Further: failures now show a calm line beside a kept result
  instead of only when the panel is empty, and `AbortSignal.timeout` has a manual
  fallback for older WebViews.

Verified on the 1.0.8 **release** APK: fresh install → type “Hallo” with default Deutsch
→ target flips to العربية and shows “مرحبًا”. Arabic→German, full-sentence auto-reroute,
force-stop restore and the previous device matrix still pass.

## 1.0.8 — personal DeepSeek key (direct mode)

1.0.4 fixed the freeze but a phone whose network cannot reach the deployed Worker still
cannot translate. 1.0.8 adds the requested **device-only BYOK path**:

- In the installed app, **Privacy → Advanced** has a DeepSeek key field. The key is stored in
  app-private DataStore, excluded from backups and never sent to today's server.
- With a key present, the WebView calls `https://api.deepseek.com/chat/completions` directly
  (CORS verified, streaming SSE, model `deepseek-flash` = DeepSeek V4.1 Flash). This bypasses
  the deployed service and its shared admission budget, so the provider's own speed applies.
- The same prompts, parsers, deterministic verification, repair and Arabic/German behaviour
  are used; the direct path falls back to the service on network/provider errors.
- Verified on a **release** diagnostic build: the only translation resource requested was
  `api.deepseek.com/chat/completions` and the result was Arabic for the German sentence.
  The key field was saved through the real UI and reported “Direct mode is active”.

## 1.0.8 — native transport fallback

1.0.5's direct path still began with a WebView `fetch`. A WebView that accepts the request
but never delivers a response, or whose CORS/proxy policy refuses the connection, would leave
the person waiting or fall back to the Worker (which may be just as unreachable). 1.0.8 makes
the device path transport-resilient:

- `streamDirect` now has a 15-second first-response budget; if the WebView fetch fails, hangs or
  dies mid-stream, the same request is retried once through **CapacitorHttp**, i.e. the Android
  network stack, which has no CORS and different proxy handling. The fallback returns one full
  response and feeds the same result pipeline.
- Verified with the DeepSeek origin deliberately removed from the WebView CSP: the fetch was
  blocked (visible CSP errors in logcat), the native fallback still produced the Arabic
  translation. This is the closest emulator reproduction of a phone whose WebView cannot make
  the cross-origin request.
- A personal build (not uploaded publicly) can seed the owner's own key once into app-private
  storage via a build-time field; it is then removed from the public release pipeline. The
  public APKs have no key (checked string-wise) and the key field remains for everyone else.

## 1.0.8 — input-state recovery (Arabic IME case)

The next report showed **text visible in the composer while the translator stayed idle**: the
message “ستظهر ترجمتك هنا”, no skeleton, no error, and no clear (X) button. That is the
signature of the DOM holding the IME composition while React state is still empty — so the
scheduler never sees any text. 1.0.8 closes that gap:

- a native `input`/`compositionupdate`/`compositionend` listener plus a 700 ms reconciliation
  poll copies the actual field value into React state;
- a scheduler watchdog forces one request if text is present and the phase is still waiting
  after 1.8 s;
- an explicit **translate-now** arrow reads the field value directly, so even a fully stale
  React state can translate what the person can see; Enter/blur also reconcile the value;
- the misleading dictation line “recording stopped” is now truthful
  (“recording couldn't start — your text is safe”), and the dictation/enrichment JSON calls
  gained the same CapacitorHttp fallback as translation.

Verified on the emulator with Arabic locale: normal Arabic input translated; and a field value
set **without any React input event** translated immediately through the arrow (DOM-only state
recovery).

## 1.0.8 — transport investigation and diagnostics

The external brief suspected CORS or a missing endpoint. Production probes disproved both:
`OPTIONS` returns `204` with the exact `https://localhost` origin, POST returns `200`
streaming text, malformed input returns `400` **with** CORS, and a disallowed origin is
`403` without ACAO. The actual no-translation symptom was the client DOM/React IME
desynchronisation fixed in 1.0.7; its screenshot lacked the clear button that React only
renders when it knows text exists.

1.0.8 adds the missing operational layer:

- safe, bounded transport diagnostics (request id, transport, origin+path, status,
  content-type, stage, timing, chunks/bytes, precise failure class) with **no text, key or
  header**; the Privacy → Advanced panel shows and copies the last translation record;
- a CapacitorHttp fallback for dictation/repair/lexicon/shadow JSON calls now sends the
  required `Origin: https://localhost` (it previously would have hit its own 403);
- HTTP/CORS tests for 4xx/429; development-only WebView debugging via `BuildConfig.DEBUG`
  while release keeps the tracked config false;
- no prompt, schema, dialect, tone or model changes.

Acceptance evidence is in `ANDROID_TRANSPORT_INVESTIGATION.md`: real preflight/POST probes,
keyless both directions, incremental chunks (19 chunks, first at 1313 ms), browser parity and
the full regression set.

## Deliverables

| Artefact                                | Path                                                                  | Size        | SHA-256                                                            |
| --------------------------------------- | --------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| Debug (installable, current data model) | `artifacts/android-1.0.8/today-1.0.8-debug.apk`                       | 6 406 086 B | `3188f18481c1ae3abda066d65ff50c7ac58820589b08007e0c751fb0be9c25b6` |
| Release review (debug-signed)           | `artifacts/android-1.0.8/today-1.0.8-release-review-debug-signed.apk` | 2 184 515 B | `9d5164e1e5fcdaa5935939ce118e87320f1d095ef99f970b5fb1fc4535a21cf3` |
| Checksums                               | `artifacts/android-1.0.8/SHA256SUMS.txt`                              | —           | —                                                                  |
| Screenshots                             | `artifacts/android-1.0.8/screenshots/`                                | —           | —                                                                  |

The `artifacts/` directory is gitignored (built output), but the files exist on the machine that
produced this report and are the exact files tested below.

## Package facts

| Fact                            | Debug                                                                              | Release review                       |
| ------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| package                         | `today.fluently.app.debug`                                                         | `today.fluently.app`                 |
| versionCode / versionName       | 9 / 1.0.8-debug                                                                    | 9 / 1.0.8                            |
| minSdk / targetSdk / compileSdk | 24 / 36 / 36                                                                       | 24 / 36 / 36                         |
| ABIs                            | arm64-v8a, armeabi-v7a, x86, x86_64                                                | same                                 |
| permissions                     | INTERNET, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, VIBRATE                             | same                                 |
| packaged shell                  | 65 `assets/public` entries, `index.html` with CSP meta, no service worker          | same                                 |
| Capacitor config                | `webContentsDebuggingEnabled=false`, mixed content off, origin `https://localhost` | same                                 |
| R8 / shrink                     | no                                                                                 | yes                                  |
| signer                          | `CN=Android Debug` (expected for debug)                                            | `CN=Android Debug` (**review only**) |

No provider key, keystore, `.env` or debug-flag `true` appears in either package. The APK scans
included `assets/*` and all `classes*.dex` `strings`.

## Verification outputs

```text
apksigner verify --verbose --print-certs today-1.0.8-debug.apk
  Verified using v2 scheme (APK Signature Scheme v2): true
  Signer #1 certificate DN: C=US, O=Android, CN=Android Debug
  Signer #1 certificate SHA-256: 02d5b40c0d3d3da6835511cf24d8b8da40cc0b36f22b97bd055b0a529ee5de9a

apksigner verify --verbose --print-certs today-1.0.8-release-review-debug-signed.apk
  Verified using v2 scheme (APK Signature Scheme v2): true
  Signer #1 certificate DN: C=US, O=Android, CN=Android Debug
  Signer #1 certificate SHA-256: 02d5b40c… (same local debug key)

aapt2 dump badging   → packages/versions/SDK/permissions/ABIs as tabled above
unzip -p … assets/capacitor.config.json → webContentsDebuggingEnabled: false
unzip -p … assets/public/index.html    → Content-Security-Policy present
strings classes*.dex | grep key patterns → no provider key
```

## Installation and run evidence

- **Debug**: installed over the previous debug install (`adb install -r`) — data survived the
  upgrade; cold launch with no uncaught JS/native errors; translated German→Arabic; force-stop
  restore verified; 3 instrumentation tests passed on the same emulator.
- **Release review**: installed clean (`package today.fluently.app`), first-run intro rendered,
  target changed to Arabic, “Guten Tag” → “سعيد نهارك”, force-stop/relaunch restored draft, result
  and target; no errors in logcat. Cold start measured 492–689 ms Displayed on the emulator.
- Uninstall/reinstall semantics: uninstalling removes the database and DataStore; the only surviving
  copy is the user-exported backup (verified earlier through SAF export/import and `pm clear`).

## Signing status — important

This environment has **no upload keystore**. The release APK is therefore signed with the local
**Android Debug** key under an explicit `-PallowDebugSigning=true` opt-out. It is installable for
review but **must not be distributed as the production release**:

- an update signed with a different key is rejected by Android;
- Play Store upload requires an upload key;
- the certificate above is not a product identity.

The release build now **fails closed** if someone forgets signing and the opt-out: that guard was
executed (`BUILD FAILED — Release signing is not configured`). TD18 stays open until a real upload
key is created outside the repository, the four environment variables are set, and the resulting
certificate is verified. See `docs/android/build-and-release.md`.

## How to install (review)

```bash
adb install -r artifacts/android-1.0.8/today-1.0.8-debug.apk
# or the review release (fresh package, cannot coexist with a store install of the same id):
adb install artifacts/android-1.0.8/today-1.0.8-release-review-debug-signed.apk
```

On a phone: copy the APK to the device, allow installation from the file manager, then open “today”.
The debug build installs alongside the release build because of the `.debug` suffix.

## Remaining limits for this release

- No physical-device/API-24–29/foldable verification (TD17, TD21).
- Review APK is debug-signed (TD18).
- Real dictation, TTS voice availability, battery and hardware performance unverified
  (TD23, TD25, TD28).
- The Android CI job is authored but has not run on GitHub yet (TD24).

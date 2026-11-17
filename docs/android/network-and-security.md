# Network and security (Android)

Status: **Implemented and partly device-verified** (2026-11-16, emulator API 35; the packaged
2026-11-17 build was also exercised on emulator-5554 for boot, restore, composer geometry and the
About entry — TD42). CORS/allowlist behaviour is covered by
`src/lib/native/gate.server.test.ts` (10 cases), and the shared analysis paths by their unit tests.
HTTPS/TLS on a device, edge behaviour and abuse at scale remain **NOT_VERIFIED**.

## Endpoints

The installed app calls the same engine as the website through a versioned native surface:

| Native route                      | Purpose                       | Web counterpart           |
| --------------------------------- | ----------------------------- | ------------------------- |
| `/api/native/v1/translate-stream` | streaming translation         | `/api/translate-stream`   |
| `/api/native/v1/repair`           | targeted repair of a result   | server function `repair`  |
| `/api/native/v1/lexicon`          | dictionary/lexicon enrichment | server function `lexicon` |
| `/api/native/v1/shadow`           | shadowing script              | server function `shadow`  |
| `/api/native/v1/dictation-token`  | short-lived AssemblyAI token  | server function           |
| `/api/native/v1/speak`            | Gemini PCM speech             | `/api/speak`              |
| `/api/native/v1/eleven-speak`     | ElevenLabs timestamped speech | `/api/eleven-speak`       |

Each native route reuses the web handler and its validation, providers, throttles and
prompts. There is no second implementation and no secret in the APK: provider keys stay
in the Worker environment. The two analysis routes are the same domain functions as the web
surfaces — `analyzeLexiconFor` and `analyzeShadowFor` with `crossOrigin: true`, because the native
origin gate already authorized the exact origin — so the candidate gate, the enrichment admission,
the long-text window plan and the provider-agnostic `runAnalysis` call are identical on both
transports; they are not a second provider call. Bodies are bounded before schema validation and
admission (`parseAdmittedJson`/`boundedJson`), so an oversized request is a 400 that spends no
token.

## Origin gate

The WebView origin is `https://localhost` (Capacitor `androidScheme: https`,
`hostname: localhost`). Every native request is cross-origin to the Worker, so
`src/lib/native/gate.server.ts` is the single gate:

- an exact allowlist: `https://localhost`, `capacitor://localhost`, `http://localhost`
  (development), plus operator additions in `NATIVE_ALLOWED_ORIGINS` (comma-separated);
- `*` is never returned, and no request without an allowed `Origin` is served;
- preflight answers only the methods and headers the app uses;
- the gate only stops arbitrary web pages from using the surface; the existing per-route
  rate limits and input bounds still apply.

No shared secret is embedded in the APK, because any such secret is extractable. Abuse
control is per-purpose throttling plus server-side keys.

## Transport

- Base URL: `https://fluently.today` by default, compiled through
  `VITE_NATIVE_API_BASE`. It is validated (HTTPS only; a single origin with no path,
  query or hash). The emulator loopback `http://10.0.2.2` is the only non-HTTPS exception
  and is never used in a release build.
- Cleartext HTTP is disabled in `network_security_config.xml` and
  `android:usesCleartextTraffic="false"`. Only system trust anchors are accepted.
- Streaming and non-streaming replies share the web completion contract: a reply that ends without
  its protocol completion event, or with a cut reason, is a provider error and is never committed
  or cached. In direct personal-key mode `direct.ts` enforces the same rule — both the SSE reader
  `directDeltas` and the buffered CapacitorHttp fallback require completion — and that path bridges
  a caller abort only until response headers; after hand-off the upstream body keeps reading until
  its own timeout (TD40). A dropped stream surfaces the existing retry/cancel behaviour. Leaving
  the foreground dispatches `lingua:flush`, which now stops cloud/device speech and cancels an
  in-flight dictation session before flushing storage (device observation limited; see TD28).
- The packaged WebView shell carries a **meta Content-Security-Policy** injected by
  `scripts/prepare-native-web.mjs` (self, inline boot scripts, the product Worker, the
  AssemblyAI WebSocket, blob AudioWorklet). The web deployment's HTTP CSP cannot reach the
  APK, so this is the backstop.
- `android.webContentsDebuggingEnabled` is false in the tracked Capacitor config and asserted
  by the Android CI job; a release must be built after a fresh `cap sync`.

## Device surface

| Permission              | Why                                                                                                                               | When                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `INTERNET`              | translation and cloud voice                                                                                                       | always required                         |
| `RECORD_AUDIO`          | dictation                                                                                                                         | requested when the person first records |
| `MODIFY_AUDIO_SETTINGS` | required by Capacitor's WebView audio-capture gate; it asks for both this and `RECORD_AUDIO` and denies when either is undeclared | normal permission, granted at install   |
| `VIBRATE`               | feel/haptics (Capacitor plugin)                                                                                                   | optional                                |

No storage, location, contacts, camera or background permissions. Backups use the
Storage Access Framework, so the app never receives broad file access.

## Data at rest

- `android:allowBackup="false"` plus `data_extraction_rules.xml` exclude the database,
  preferences and files from Google cloud backup and device transfer. Personal sentences
  leave the device only through an explicit export.
- The database is in the app's private sandbox; no file is world-readable, no external
  storage is used. **No app-level database encryption is implemented** — the accepted
  at-rest decision and its threat model are recorded in
  [ADR 0008](../architecture/decisions/0008-android-data-at-rest.md) (TD19 closed). Android
  file-based encryption protects the sandbox while the device is locked; a rooted/forensic
  device can read the archive.
- Backups can be encrypted with a password (AES-256-GCM, PBKDF2-SHA256 210 000 iterations);
  passwords are never stored. Plain backups carry an unkeyed digest: it detects damage, not
  deliberate rewrites.

## Optional personal provider key (BYOK)

The installed app can hold one device-only DeepSeek key (the About page's **Advanced** section).
It is saved in
app-private DataStore, excluded from the backup whitelist, never logged and never sent to the
Worker. When present, the WebView calls `https://api.deepseek.com/chat/completions` directly;
the native CSP allows that origin and the same prompts/parsers/verifiers are used. Without a
key the app keeps the server path. The build rejects `PERSONAL_DEEPSEEK_KEY`; no provider key
may be compiled into any APK, and CI scans the extracted APK rather than only web assets. ADR
0009 records the security boundary and the residual risk (a key typed by the person is readable
on a rooted device; TD30 tracks Keystore wrapping).

## Release signing

A release build fails closed when no upload key is configured. `-PallowDebugSigning=true`
is an explicit local-review opt-out that prints a warning and produces a **non-publishable**
APK (TD18). "Release" in build logs always names the signer.

## Logging and privacy

- Kotlin rejects with short, fixed messages ("device storage unavailable"); no SQL,
  values, URLs or stack traces reach the WebView console or logcat.
- The app has no analytics, ads, crash reporter or third-party SDK beyond Capacitor.
- The About page (`/about`) lists exactly what leaves the device; the installed app renders the
  same page, and its Data settings state that uninstalling deletes the device copy.

## Threat notes

| Threat                                    | Mitigation                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Malicious web page calling the native API | exact Origin allowlist; `*` never returned                                                                                            |
| Extracting a key from the APK             | no provider key is in the APK; keys live in Worker env                                                                                |
| Intercepting traffic                      | HTTPS only, cleartext disabled, system trust anchors                                                                                  |
| Tampered backup file                      | SHA-256 digest; wrong digest refused before writing                                                                                   |
| Reading the archive from a backup         | OS backup disabled; manual export only, optionally encrypted                                                                          |
| A webview XSS reading records             | records are validated on read/write, rendered as text, no `innerHTML` for user content; storage exposed only through the typed bridge |

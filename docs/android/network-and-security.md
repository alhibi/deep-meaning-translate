# Network and security (Android)

Status: **Implemented**. CORS/allowlist behaviour is covered by TypeScript tests; TLS and
WebView behaviour on a device are **NOT_VERIFIED**.

## Endpoints

The installed app calls the same engine as the website through a versioned native surface:

| Native route | Purpose | Web counterpart |
| --- | --- | --- |
| `/api/native/v1/translate-stream` | streaming translation | `/api/translate-stream` |
| `/api/native/v1/repair` | targeted repair of a result | server function `repair` |
| `/api/native/v1/lexicon` | dictionary/lexicon enrichment | server function `lexicon` |
| `/api/native/v1/shadow` | shadowing script | server function `shadow` |
| `/api/native/v1/dictation-token` | short-lived AssemblyAI token | server function |
| `/api/native/v1/speak` | Gemini PCM speech | `/api/speak` |
| `/api/native/v1/eleven-speak` | ElevenLabs timestamped speech | `/api/eleven-speak` |

Each native route reuses the web handler and its validation, providers, throttles and
prompts. There is no second implementation and no secret in the APK: provider keys stay
in the Worker environment.

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
- Streaming uses the same SSE reader as the web; a dropped stream surfaces the existing
  retry/cancel behaviour. Voice streams use the native speech endpoint and are stopped
  when the app backgrounds.

## Device surface

| Permission | Why | When |
| --- | --- | --- |
| `INTERNET` | translation and cloud voice | always required |
| `RECORD_AUDIO` | dictation | requested when the person first records |
| `VIBRATE` | feel/haptics (Capacitor plugin) | optional |

No storage, location, contacts, camera or background permissions. Backups use the
Storage Access Framework, so the app never receives broad file access.

## Data at rest

- `android:allowBackup="false"` plus `data_extraction_rules.xml` exclude the database,
  preferences and files from Google cloud backup and device transfer. Personal sentences
  leave the device only through an explicit export.
- The database is in the app's private sandbox; no file is world-readable, no external
  storage is used. Optional database encryption is not implemented (see technical debt);
  Android's file-based encryption protects the sandbox at rest on modern devices.
- Backups can be encrypted with a password (AES-GCM, PBKDF2-SHA256 210 000 iterations);
  passwords are never stored.

## Logging and privacy

- Kotlin rejects with short, fixed messages ("device storage unavailable"); no SQL,
  values, URLs or stack traces reach the WebView console or logcat.
- The app has no analytics, ads, crash reporter or third-party SDK beyond Capacitor.
- The privacy page lists exactly what leaves the device; the installed app uses the same
  page, and Data settings states that uninstalling deletes the device copy.

## Threat notes

| Threat | Mitigation |
| --- | --- |
| Malicious web page calling the native API | exact Origin allowlist; `*` never returned |
| Extracting a key from the APK | no provider key is in the APK; keys live in Worker env |
| Intercepting traffic | HTTPS only, cleartext disabled, system trust anchors |
| Tampered backup file | SHA-256 digest; wrong digest refused before writing |
| Reading the archive from a backup | OS backup disabled; manual export only, optionally encrypted |
| A webview XSS reading records | records are validated on read/write, rendered as text, no `innerHTML` for user content; storage exposed only through the typed bridge |

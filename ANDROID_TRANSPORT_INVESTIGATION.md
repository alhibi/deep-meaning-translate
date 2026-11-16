# Android translation transport investigation (1.0.8)

Date: 2026-11-16 · Branch: `main` · Android shell 1.0.8 (`versionCode 9`)

This report investigates the supplied engineering brief (“Critical Engineering
Investigation — Translation Pipeline Failure in Android APK v1.0.6”). It separates what was
actually broken from hypotheses that the production probe disproved, records the code
changes, and lists the acceptance evidence. The translation prompts, response schema,
dialect/tone system and DeepSeek model were **not** changed.

## Executive summary

1. **The deployed endpoint and its CORS behaviour are healthy.** A real `OPTIONS` preflight
   from `https://localhost` returns `204` with the exact allowed origin, methods, headers,
   `Vary: Origin` and no wildcard. A real `POST` returns `200 text/plain`, and the body
   arrives in multiple chunks. Malformed input returns `400` **with** CORS headers; a
   disallowed origin returns `403` without `Access-Control-Allow-Origin` (correct).
2. **The failing phone was not a CORS/backend failure.** Its screenshot showed Arabic text
   in the composer with **no clear (X) button** and the idle “your translation will appear
   here” placeholder. That is the signature of the Android IME painting the field while
   React state stayed empty, so the scheduler never saw text. 1.0.8 repaired this with
   native input/composition listeners, a value reconciliation loop, an explicit
   translate-now action and a scheduler watchdog. The reproduction (DOM-only value) and the
   fix are recorded below.
3. **One real transport defect was found and fixed:** the CapacitorHttp fallback for JSON
   endpoints (dictation token, repair, lexicon, shadow) did not send an `Origin` header, so
   the native gate would have answered its own retry with `403`. It now sends
   `Origin: https://localhost` and records a diagnostic.
4. **Diagnostics are now real.** Every translation request has a client request id, transport,
   URL (origin + path only), status, content-type, duration, chunk/byte counts, stage and a
   precise failure class. No sentence, header, token or key is stored. A Privacy → Advanced
   panel shows the last record and can copy it safely.
5. **Streaming is preserved on the normal path.** The browser fetch path consumes
   `response.body.getReader()` and updates the result per chunk; a production probe measured
   19 chunks, first at 1313 ms and complete at 1647 ms. The native fallback used only when
   WebView fetch fails is buffered (TD32); it is not the normal path and is now visible in
   diagnostics.
6. **WebView debugging is dev-only.** Release stays `webContentsDebuggingEnabled=false`;
   debug builds enable chrome inspection from `MainActivity` via `BuildConfig.DEBUG`.

## 1. Request path and deployed contract

Source path (the supplied minified names Wi/H/ji/Ai map to this path):

`streamTranslate()` in `src/lib/translation/stream.ts` → absolute native URL from
`nativeApiUrl()` → `POST /api/native/v1/translate-stream` → TanStack route
`src/routes/api/native/v1/translate-stream.ts` → `nativeEndpoint(nativeGate)` →
`handleTranslateStream()` (`src/lib/translation/streamRoute.server.ts`).

The route exists in source and in the deployment. Production probes:

```text
OPTIONS https://fluently.today/api/native/v1/translate-stream
  Origin: https://localhost
  Access-Control-Request-Method: POST
  Access-Control-Request-Headers: content-type
→ HTTP/2 204
  access-control-allow-origin: https://localhost
  access-control-allow-methods: GET, POST, OPTIONS
  access-control-allow-headers: Content-Type, Accept
  access-control-expose-headers: Retry-After
  access-control-max-age: 600
  vary: Origin
  cache-control: no-store
```

```text
POST https://fluently.today/api/native/v1/translate-stream
  Origin: https://localhost
  Content-Type: application/json
→ HTTP/2 200
  content-type: text/plain; charset=utf-8
  access-control-allow-origin: https://localhost
  vary: Origin
  19 chunks · 201 bytes · first chunk 1313 ms · complete 1647 ms
```

Live mode is a plain-text stream; full mode is structured JSON, parsed by the existing
`parseResult` path. No redirect is involved. Error probes:

| Probe                         | Status                      | CORS                                             |
| ----------------------------- | --------------------------- | ------------------------------------------------ |
| malformed JSON                | 400 JSON                    | `Access-Control-Allow-Origin: https://localhost` |
| origin `https://evil.example` | 403 JSON                    | no ACAO (browser must block)                     |
| handler exception path        | 502 generic JSON            | CORS merged by `nativeEndpoint`                  |
| 429/4xx handler response      | wrapped by `withNativeCors` | unit test `gate.server.test.ts`                  |

The gate is exact-match, fail-closed, and only enables `http://localhost` when
`NODE_ENV` is explicitly `development`/`test`. `OPTIONS` is handled before admission,
body validation or provider work.

## 2. Capacitor HTTP audit

The tracked `capacitor.config.ts` does **not** enable global CapacitorHttp fetch patching
(there is no `plugins.CapacitorHttp.enabled`), so normal translation uses the WebView
`fetch` path and preserves streaming. The app does explicitly call the CapacitorHttp plugin
as a **fallback** when WebView fetch fails/hangs or when the user's network blocks the
cross-origin request.

That fallback is buffered by CapacitorHttp. It is not the normal transport and does not
replace the streaming path; the buffered fallback is recorded as TD32 and appears as
`capacitor-http` in diagnostics. A future native streaming transport can replace it without
touching prompts, parsers or the translation engine.

Defect fixed: `nativeJsonViaHttp` previously posted without an `Origin` header. The native
gate correctly requires it, so the fallback would have retried its own request into a 403.
The header is now explicit and the request is recorded.

## 3. Diagnostics

`src/lib/native/diagnostics.ts` records, bounded to 24 entries:

- client request id (12 chars, never sent as a custom CORS header);
- native/web platform, transport (`webview-fetch`, `capacitor-http`, `server-json`,
  `deepseek-direct`), method, origin+path only;
- HTTP status, content-type, stage, duration, chunks, bytes;
- failure class: `http-401/403/404/429/5xx/other`, `offline`, `timeout`, `abort`, `dns`,
  `tls`, `cors`, `network-or-cors`, `empty`, `malformed`, `stream`, `provider`,
  `auth`, `quota`, `rate`, `input`.

The browser deliberately hides whether a failed fetch was CORS, DNS or TLS; the classifier
does not pretend otherwise and reports `network-or-cors` unless the native platform supplies
a concrete exception (`UnknownHostException`, `SSLHandshakeException`, …). Native fallback
errors are recorded separately.

No sentence, prompt, key, Authorization header or body is stored; error messages are
redacted and truncated. The Privacy → Advanced panel displays the last record and a copy
button. Development builds enable WebView debugging only via `BuildConfig.DEBUG`; release
keeps the tracked `webContentsDebuggingEnabled=false`.

## 4. Root cause of the reported “typing does nothing”

The v1.0.6 phone screenshot showed:

- text “مرحبا” visibly painted in the composer;
- **no clear (X) button**, which only renders when React `hasText` is true;
- the idle result placeholder, not a skeleton or an error.

That combination proves the DOM held an IME composition while React state was empty. The
scheduler therefore never saw text. 1.0.8 added:

- native `input` / `compositionupdate` / `compositionend` listeners;
- a 700 ms DOM-to-state reconciliation poll;
- a 1.8 s scheduler watchdog that forces a request if the phase stays waiting;
- an always-available translate-now arrow that reads the field value directly;
- Enter/blur reconciliation.

Reproduction on the emulator: set the field to a value **without dispatching any React input
event**, then press the arrow → “شكرا” translated to “Danke”. Normal Arabic input with the
Arabic locale also translates. The earlier 1.0.6 transport-only changes did not address this
client-state layer.

The dictation line was also corrected from “Recording stopped” to “Recording couldn't start
— your text is safe” when no recording began.

## 5. Acceptance evidence

| #   | Criterion                              | Result                  | Evidence                                                                  |
| --- | -------------------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| 1   | OPTIONS from real Android origin       | **PASS**                | production curl above; 204, exact headers, `Vary: Origin`                 |
| 2   | POST reaches deployed endpoint         | **PASS**                | production POST 200 `text/plain`; Android keyless debug translation       |
| 3   | German → Arabic                        | **PASS**                | Android keyless: “Kannst du… Bahnhof?” → “ممكن تقول لي… المحطة؟”          |
| 4   | Arabic → German                        | **PASS**                | Android keyless: “مرحبا” → “Hallo”                                        |
| 5   | Both directions without a personal key | **PASS**                | keyless debug build, server path only                                     |
| 6   | Progressive streaming                  | **PASS (normal path)**  | 19 chunks, first at 1313 ms, complete 1647 ms; result updates per chunk   |
| 7   | Completed output parsed and displayed  | **PASS**                | structured result + quality badge; full mode parse                        |
| 8   | Distinguishable diagnostics            | **PASS (unit + panel)** | diagnostics classifier tests; HTTP/CORS probes; browser limits documented |
| 9   | Browser version                        | **PASS**                | Mac Chrome: German → Arabic at `localhost:8080`                           |
| 10  | No regressions                         | **PASS**                | full `npm run verify`; Android JVM/instrumentation tests                  |

## 6. Limitations and follow-up

- Physical devices, API 24–29, OEM keyboards and foldables remain NOT_VERIFIED.
- The native JSON fallback is buffered (TD32). It is only used when WebView fetch fails;
  the normal path streams.
- Browser JavaScript cannot distinguish CORS from DNS/TLS; the diagnostics classifier is
  explicit about this limitation and uses native exceptions where available.
- The app still has no native dictation fallback when the cloud token service is unreachable;
  the message is now truthful and the JSON retry uses CapacitorHttp.

## 7. Code changes in this investigation

- `src/lib/native/diagnostics.ts` (new) and `DiagnosticsPanel.tsx` (new): safe records and UI.
- `src/lib/translation/stream.ts`: request ids, status/content-type/stage/chunk/byte records,
  error classification.
- `src/lib/native/transport.ts`: diagnostics, `Origin` on CapacitorHttp fallback.
- `src/lib/translation/direct.ts`: direct-mode diagnostics.
- `src/lib/native/gate.server.test.ts`: 429/4xx CORS coverage.
- `android/.../MainActivity.kt`: debug-only WebView debugging.
- `src/lib/native/diagnostics.test.ts` (new): classifier/redaction/URL tests.

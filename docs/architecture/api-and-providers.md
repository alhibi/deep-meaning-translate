# API and Provider Boundaries

Status: **Verified** by source inspection and unit tests on 2026-11-18 (strict model selection and
the immediate full request), plus live DeepSeek `deepseek-flash` capability probes and calls from
the dev server. Provider uptime, the Luna/OpenCode account, cloud voice and dictation remain
**NOT_VERIFIED** in this environment.

## Endpoints

| Endpoint                      | Method | Purpose                                                         | Protection                                         |
| ----------------------------- | ------ | --------------------------------------------------------------- | -------------------------------------------------- |
| `/api/translate-stream`       | `GET`  | Preload provider modules and open the connection; sends no text | `takeWarmToken` per client                         |
| `/api/translate-stream`       | `POST` | Stream a full structured translation (live text only for salvage) | same-origin, `takeToken`, bounded JSON, Zod schema |
| `/api/speak`                  | `POST` | Cloud speech (Gemini PCM)                                       | same-origin, speech throttle, server key           |
| `/api/eleven-speak`           | `POST` | Cloud speech with timestamps                                    | same-origin, speech throttle, server key           |
| server fn `translate`         | `POST` | Non-streaming structured translation                            | same-origin, `takeToken`, `InputSchema`            |
| server fn `repairTranslation` | `POST` | Quiet same-model repair of a shown result                           | same-origin, `takeRepairToken`                     |
| server fn `analyzeShadow`     | `POST` | Sentence Shadow analysis                                        | same-origin, enrichment throttle                   |
| server fn lexicon             | `POST` | Dictionary enrichment                                           | same-origin, enrichment throttle                   |

Server functions are invoked through TanStack Start's `/_serverFn/...` transport; translation text
is never placed in a URL.

The streaming handler and the two analysis server functions are shared code, not endpoint-local
copies: `streamRoute.server.ts` serves the web route and its native counterpart, while
`analyzeLexiconFor` and `analyzeShadowFor` serve both the browser server function and the native
route. The analysis functions never import a provider — they call
`engine.server.runAnalysis(system, user, {signal, chars})`, which alone chooses the provider and the
analysis profile — and each prompt, schema and parser lives with its feature (`lexicon.ts`,
`shadow.ts`) so a schema change updates both sides together.

## Input contract

`InputSchema` (Zod): trimmed text 1–5,000 characters; `source` = two lowercase letters or `auto`;
`target` = two lowercase letters; `style` ∈ natural/formal/casual; `dialect` ∈
auto/msa/levant/egypt/gulf/iraq/maghreb; `brain` ∈ deepseek/luna; `partial` boolean. Storage
validators mirror the language and style constraints so a restored value can never be rejected by
the server.

The enrichment surfaces have their own strictly-shaped schemas and are bounded twice, so one bad
client can never enlarge an analysis prompt or body: the transport bound sits at twice the semantic
cap, and an over-long string becomes a quiet `null` instead of a schema error while a legitimate
astral character still counts once. Lexicon term ≤200 code points (the semantic gate accepts 96),
ranking translation ≤400 (gate 200), context ≤800 (gate 400); Sentence Shadow source ≤5,000 and
translation ≤15,000 units, both required non-blank and untrimmed so the text offsets the model
quotes stay exact. Bounds are checked before admission, so an oversized body spends no token.

## Streaming contract

- **Full**: the stream carries the selected model's structured JSON; translation text streams out of
  the JSON while it is generated and the committed answer is parsed and verified client-side. This is
  the only mode normal scheduling uses.
- **Live**: `text/plain` incremental text, used **only** for the one salvage request after a cut or
  unreadable structured answer, still through the same selected model.
- `Cache-Control: no-store, no-transform`; the response is not cached by the service worker.
- Client cancellation aborts the upstream request **and** the client's response reader, so a body
  that never sends another chunk cannot keep a dead request alive. A cancelled stream ends quietly
  (204 / closed stream), not as a provider error, and is never retried. The small JSON error body is
  read before returning so the server's `kind` (auth/quota/rate/provider) reaches the UI instead of
  collapsing into a generic provider error.
- The provider's protocol completion is required before a stream is committed: OpenAI
  `finish_reason: "stop"` or Responses `response.completed`. `finish_reason: "length"` /
  `content_filter` / an unknown reason, `response.incomplete` and a premature EOF raise a provider
  error; `[DONE]` cannot mark a cut answer complete.
- **Non-streaming replies obey the same contract.** `providers/completion.ts` `requireCompletion`
  makes `stop` the only success; `length`, `content_filter`, `tool_calls`, an unknown reason and a
  missing reason are provider errors, so a cut reply is classified as truncation rather than
  surfacing later as "malformed model output". The server chat path, the native buffered fallback
  and the direct repair path call it, and `direct.ts` `directDeltas` mirrors the streaming rule
  (including EOF without a completion) for the personal-key path.
- A full-answer failure is salvaged **once** by the client as a plain live stream through the
  **same selected model**; the salvage text runs through the deterministic verifier and is never
  stored in translation memory.
- Output ceilings are a runaway guard and are set per task class in `providers/capabilities.ts`:
  live salvage 8,192, full 16,384, same-model repair 32,768, analysis 65,536, none above the
  documented 384K provider bound. `budget.ts` supplies the plain-answer floor/factor beneath that,
  and a reasoning class only raises the ceiling. A 5,000-character full request sends 13,000 tokens
  and is verified end-to-end.

## Provider selection

`src/lib/translation/types.ts` defines `DEFAULT_BRAIN = "deepseek"` and **`LUNA_ENABLED = true`**.
`effectiveBrain()` returns the selected or saved brain, falling back to DeepSeek only when none was
chosen. Selection is **strict**:

- the request's `brain` is the only writer (`deepseek` default, `luna` when selected); the other
  model is never called for that translation, never takes over after a failure, and never reviews or
  corrects the answer;
- the foreground stream route makes **one attempt** on the selected provider (`maxAttempts: 1`) and
  never sleeps through `Retry-After`, retries automatically or switches model. A selected model that
  is unavailable or refuses the request produces a calm, retryable error — the result of the other
  model never appears under its name;
- the stream response names the one writer (`X-Translation-Writer`); the server log records the
  model, `upstreamMs`, outcome, duration and character count, never text;
- the OpenCode/Luna path covers live and full streaming plus buffered repair, all on the selected
  model; its routing header now carries a valid, per-request `ses_` session id and the documented
  companion header (the previous static, invalid-shaped value is corrected);
- dictionary and Sentence Shadow analysis deliberately stays on DeepSeek: its capability profile is
  verified only there, it is an optional reading, and it never edits the selected model's
  translation;
- a single configured key yields a working translator **for that model only**; selecting the
  unconfigured model returns its own auth error instead of silently using the other one.

Provider keys are read only in server modules (`process.env`), never in client code.

## Task capability profiles

`providers/capabilities.ts` is the one table of what each task class may ask the provider for,
verified against the official DeepSeek API documentation on 2026-11-17. A provider-doc change edits
this table, never a call site:

| Profile    | Used by                                                  | Thinking / effort | JSON mode | `max_tokens` ceiling |
| ---------- | -------------------------------------------------------- | ----------------- | --------- | -------------------- |
| `live`     | salvage stream only after a cut/unreadable full answer   | off               | no        | 8,192                |
| `full`     | every foreground translation (immediate, structured)     | off               | yes       | 16,384               |
| `repair`   | quiet same-model correction after deterministic issues   | off               | yes       | 32,768               |
| `analysis` | dictionary, Sentence Shadow and future text-in/JSON-out  | on, max           | yes       | 65,536               |

The 8,192 live profile is not part of normal scheduling: there is no provisional live request.
Thinking is **explicit per class** because the API defaults it on with high effort: an omitted toggle
silently turns a fast request into a reasoning one. The analysis class carries a much higher ceiling
because a live probe on 2026-11-17 showed reasoning tokens are charged against `max_tokens`; a
ceiling that only fits the plain answer would truncate it. All ceilings are runaway bounds, never
targets, and none can exceed the documented 384K output bound.

## Failure classification

`TranslationError.kind` ∈ `auth | quota | rate | network | provider | input`.

- `auth` / `quota`: configuration or account problem for the **selected** model; the user sees a
  calm provider state and a retry, never the other model.
- `rate`: the selected provider is rate limiting; the foreground route returns it immediately and
  the client shows the rate state at once.
- `network` / `provider`: shown immediately by the foreground route (one attempt, no retry, no
  model switch). Background repair/analysis keeps its bounded retry because nothing is waiting on
  it. A **truncated reply** — streaming or non-streaming, a cut stream, or EOF before the protocol
  completion — is a `provider` error, never a success that a later parser misreports.
- `input`: invalid body or cross-origin request; 400/403, never retried.
- Cancellation (`AbortError`, client abort) is not an error and produces no failure state. A
  cancelled stream is never salvaged or retried. On the Android personal-key path, the abort is
  bridged only until response headers; after hand-off the upstream body keeps reading until its own
  timeout (TD40).

The route logs metrics only: event, mode, brain, outcome, duration, character count. It never logs
text or the translation. Provider error messages carry the HTTP status only; the provider body is
cancelled, never copied into an error or a log.

Body size and schema are checked **before** admission: malformed or oversized input returns 400 and
does not spend the client's token. Only a schema-valid body reaches the rate limiter.

## Rate limiting

Process-local bounded token buckets, one per purpose: **foreground translation** (180 burst / 4 per
second: every coalesced typing update is a full request), **live salvage** (120 / 4), warm-up
(20 / 0.5), repair (60 / 1), enrichment (60 / 1.5), speech (40 / 1.2) and dictation token minting
(20 / 0.5). The browser and native surfaces share these buckets through their domain functions —
dictionary and shadow analysis spend the enrichment budget, the native repair route spends the
repair budget — so a second transport cannot mint a second allowance. These are admission limits
sized above a continuous fast typist, not a model throttle: the foreground full-request bucket is
not shared with background work, and a hidden repair is the first thing to shed under load.
Admission is chosen from the validated `mode` after the body is parsed. This protects a single
instance; it is not a deployment-wide abuse defence, and the documentation says so rather than
implying otherwise.

## Provider failure UX

A failed translation preserves the draft and the previous good result. The error surface is
translated and offers retry. No raw provider message, status code or stack trace reaches the person.

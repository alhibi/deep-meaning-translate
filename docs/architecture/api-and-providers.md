# API and Provider Boundaries

Status: **Verified** by source inspection and unit tests on 2026-11-17, plus live DeepSeek
`deepseek-flash` capability probes (one per task class, synthetic input, key not printed) and
calls from the dev server (latency, structured JSON, long input). Provider uptime, Luna/OpenCode,
cloud voice and dictation remain **NOT_VERIFIED** in this environment.

## Endpoints

| Endpoint                      | Method | Purpose                                                         | Protection                                         |
| ----------------------------- | ------ | --------------------------------------------------------------- | -------------------------------------------------- |
| `/api/translate-stream`       | `GET`  | Preload provider modules and open the connection; sends no text | `takeWarmToken` per client                         |
| `/api/translate-stream`       | `POST` | Stream live plain text or a full structured translation         | same-origin, `takeToken`, bounded JSON, Zod schema |
| `/api/speak`                  | `POST` | Cloud speech (Gemini PCM)                                       | same-origin, speech throttle, server key           |
| `/api/eleven-speak`           | `POST` | Cloud speech with timestamps                                    | same-origin, speech throttle, server key           |
| server fn `translate`         | `POST` | Non-streaming structured translation                            | same-origin, `takeToken`, `InputSchema`            |
| server fn `repairTranslation` | `POST` | Quiet repair/review of a shown result                           | same-origin, `takeRepairToken`                     |
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

- **Live**: `Content-Type: text/plain; charset=utf-8`, incremental text, no JSON. The client wraps it
  as a provisional result for display only.
- **Full**: the stream carries the model's structured JSON, parsed and verified client-side.
- `Cache-Control: no-store, no-transform`; the response is not cached by the service worker.
- Client cancellation aborts the upstream request **and** the client's response reader, so a body
  that never sends another chunk cannot keep a dead request alive; an unread error body is
  cancelled instead of holding the connection. A cancelled stream ends quietly (204 / closed
  stream), not as a provider error, and is never retried.
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
- A full-answer failure is salvaged **once** by the client as a plain live stream; the salvage text
  runs through the deterministic verifier and is never stored in translation memory.
- Output ceilings are a runaway guard and are set per task class in `providers/capabilities.ts`:
  live 8,192, settled full 16,384, repair and review ≥32,768, analysis 65,536, none above the
  documented 384K provider bound. `budget.ts` supplies the plain-answer floor/factor beneath that,
  and a reasoning class only raises the ceiling. A 5,000-character full request sends 13,000 tokens
  and is verified end-to-end.

## Provider selection

`src/lib/translation/types.ts` defines `DEFAULT_BRAIN = "deepseek"` and **`LUNA_ENABLED = false`**.
`effectiveBrain()` therefore returns `deepseek` for every request, including an old saved
preference that says `luna`. While paused:

- no Luna request is attempted;
- there is no Luna→DeepSeek or DeepSeek→Luna fallback, because the disabled provider is not a
  candidate;
- the engine's fallback helpers remain implemented for the day the flag is enabled.

Provider keys are read only in server modules (`process.env`), never in client code. DeepSeek is
the active writer; the OpenCode/Luna provider remains in the codebase behind the flag.

## Task capability profiles

`providers/capabilities.ts` is the one table of what each task class may ask the provider for,
verified against the official DeepSeek API documentation on 2026-11-17. A provider-doc change edits
this table, never a call site:

| Profile    | Used by                                                 | Thinking / effort | JSON mode | `max_tokens` ceiling |
| ---------- | ------------------------------------------------------- | ----------------- | --------- | -------------------- |
| `live`     | provisional streams while typing                        | off               | no        | 8,192                |
| `full`     | settled structured translation                          | off               | yes       | 16,384               |
| `repair`   | quiet second pass after deterministic issues            | on, high          | yes       | 32,768               |
| `review`   | independent review of a shown translation               | on, high          | yes       | 32,768               |
| `analysis` | dictionary, Sentence Shadow and future text-in/JSON-out | on, max           | yes       | 65,536               |

Thinking is **explicit per class** because the API defaults it on with high effort: an omitted
toggle silently turns a fast live request into a reasoning one. The reasoning classes carry a much
higher ceiling because a live probe on 2026-11-17 showed reasoning tokens are charged against
`max_tokens` (with `max_tokens: 10` and thinking on, the reply was `finish_reason: "length"` with
an empty answer and ten reasoning tokens); a ceiling that only fits the plain answer would truncate
it. All ceilings are runaway bounds, never targets, and none can exceed the documented 384K output
bound.

Long input has one rule: `assertContextFits` sizes source, prompt overhead and output ceiling
against the documented 1M-token context **before** any fetch. The app's own schemas cap a
translation at 5,000 characters and every analysis prompt far below that, so one request always fits
and **no splitting exists**; a theoretically impossible input is a loud `input` error instead of a
truncation or a chunked translation that could lose order or term consistency.

## Failure classification

`TranslationError.kind` ∈ `auth | quota | rate | network | provider | input`.

- `auth` / `quota`: configuration or account problem; the user sees a calm provider state.
- `rate`: 429 with `Retry-After`; a live request stays silent while typing, a settled request shows
  a rate state.
- `network` / `provider`: transient. The provider boundary retries once **only before** the
  response body is handed off (transient status, or network failure; `Retry-After` clamped to
  2.5 s, 200–600 ms jitter otherwise) and the client may retry once more. A caller abort, a
  401/402, and an already-started stream are never retried. A **truncated reply** — streaming or
  non-streaming, a cut stream, or EOF before the protocol completion — is a `provider` error, never
  a success that a later parser misreports.
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

Process-local bounded token buckets, one per purpose: **live typing** (120 burst / 4 per second),
**settled translation** (90 / 2), warm-up (20 / 0.5), repair (60 / 1), enrichment (60 / 1.5),
speech (40 / 1.2) and dictation token minting (20 / 0.5). The browser and native surfaces share
these buckets through their domain functions — dictionary and shadow analysis spend the enrichment
budget, the native repair route spends the repair budget — so a second transport cannot mint a
second allowance. These are admission limits sized above human typing, not a
model throttle: a fast typist's provisional streams are never refused mid-sentence, while a
scripted client is still bounded. The live and settled budgets are deliberate separate buckets: a
person typing continuously can spend the provisional allowance without ever touching the allowance
their finished sentence needs. Background work cannot spend either, and a hidden repair is the
first thing to shed under load. Admission is chosen from the validated `mode` after the body is
parsed. This protects a single instance; it is not a
deployment-wide abuse defence, and the documentation says so rather than implying otherwise.

## Provider failure UX

A failed translation preserves the draft and the previous good result. The error surface is
translated and offers retry. No raw provider message, status code or stack trace reaches the person.

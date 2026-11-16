# API and Provider Boundaries

Status: **Verified** by source inspection and unit tests on 2026-11-16, plus live DeepSeek
`deepseek-flash` calls from the dev server (latency, structured JSON, long input). Provider uptime,
Luna/OpenCode, cloud voice and dictation remain **NOT_VERIFIED** in this environment.

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

## Input contract

`InputSchema` (Zod): trimmed text 1–5,000 characters; `source` = two lowercase letters or `auto`;
`target` = two lowercase letters; `style` ∈ natural/formal/casual; `dialect` ∈
auto/msa/levant/egypt/gulf/iraq/maghreb; `brain` ∈ deepseek/luna; `partial` boolean. Storage
validators mirror the language and style constraints so a restored value can never be rejected by
the server.

## Streaming contract

- **Live**: `Content-Type: text/plain; charset=utf-8`, incremental text, no JSON. The client wraps it
  as a provisional result for display only.
- **Full**: the stream carries the model's structured JSON, parsed and verified client-side.
- `Cache-Control: no-store, no-transform`; the response is not cached by the service worker.
- Client cancellation aborts the upstream request. A cancelled stream ends quietly (204 / closed
  stream), not as a provider error.
- The provider's protocol completion event is required before a stream is committed: OpenAI
  `finish_reason: "stop"` or Responses `response.completed`. `finish_reason: "length"` /
  `content_filter` / an unknown reason, `response.incomplete` and a premature EOF raise a provider
  error; `[DONE]` cannot mark a cut answer complete.
- A full-answer failure is salvaged **once** by the client as a plain live stream; the salvage text
  runs through the deterministic verifier and is never stored in translation memory.
- Output ceilings are a runaway guard (`budget.ts`): structured 16,384 tokens, live 8,192, with
  floors 512/256 and factors 2.6/1.5. The provider accepted 16,384 on `deepseek-flash` when probed
  on 2026-11-16; a 5,000-character full request now sends 13,000 and completes.

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

## Failure classification

`TranslationError.kind` ∈ `auth | quota | rate | network | provider | input`.

- `auth` / `quota`: configuration or account problem; the user sees a calm provider state.
- `rate`: 429 with `Retry-After`; a live request stays silent while typing, a settled request shows
  a rate state.
- `network` / `provider`: transient. The provider boundary retries once **only before** the
  response body is handed off (transient status, or network failure; `Retry-After` clamped to
  2.5 s, 200–600 ms jitter otherwise) and the client may retry once more. A caller abort, a
  401/402, and an already-started stream are never retried.
- `input`: invalid body or cross-origin request; 400/403, never retried.
- Cancellation (`AbortError`, client abort) is not an error and produces no failure state.

The route logs metrics only: event, mode, brain, outcome, duration, character count. It never logs
text or the translation. Provider error messages carry the HTTP status only; the provider body is
cancelled, never copied into an error or a log.

Body size and schema are checked **before** admission: malformed or oversized input returns 400 and
does not spend the client's token. Only a schema-valid body reaches the rate limiter.

## Rate limiting

Process-local bounded token buckets, one per purpose: **live typing** (120 burst / 4 per second),
**settled translation** (90 / 2), warm-up (20 / 0.5), repair (60 / 1), enrichment (60 / 1.5),
speech, and dictation token minting. These are admission limits sized above human typing, not a
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

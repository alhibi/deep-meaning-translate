# API and Provider Boundaries

Status: **Verified** by source inspection on 2026-11-07. No live provider request was made (no
keys); response quality and provider uptime are **NOT_VERIFIED**.

## Endpoints

| Endpoint | Method | Purpose | Protection |
| --- | --- | --- | --- |
| `/api/translate-stream` | `GET` | Preload provider modules and open the connection; sends no text | `takeWarmToken` per client |
| `/api/translate-stream` | `POST` | Stream live plain text or a full structured translation | same-origin, `takeToken`, bounded JSON, Zod schema |
| `/api/speak` | `POST` | Cloud speech (Gemini PCM) | same-origin, speech throttle, server key |
| `/api/eleven-speak` | `POST` | Cloud speech with timestamps | same-origin, speech throttle, server key |
| server fn `translate` | `POST` | Non-streaming structured translation | same-origin, `takeToken`, `InputSchema` |
| server fn `repairTranslation` | `POST` | Quiet repair/review of a shown result | same-origin, `takeRepairToken` |
| server fn `analyzeShadow` | `POST` | Sentence Shadow analysis | same-origin, enrichment throttle |
| server fn lexicon | `POST` | Dictionary enrichment | same-origin, enrichment throttle |

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
- The provider's protocol completion event is required before a stream is committed; a truncated
  stream is not cached as a settled answer.

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
- `network` / `provider`: transient; one client retry after a short delay.
- `input`: invalid body or cross-origin request; 400/403, never retried.
- Cancellation (`AbortError`, client abort) is not an error and produces no failure state.

The route logs metrics only: event, mode, brain, outcome, duration, character count. It never logs
text or the translation. Provider error messages carry the HTTP status only; the provider body is
cancelled, never copied into an error or a log.

Body size and schema are checked **before** admission: malformed or oversized input returns 400 and
does not spend the client's token. Only a schema-valid body reaches the rate limiter.

## Rate limiting

Process-local bounded token buckets, one per purpose: **live typing**, **settled translation**,
warm-up, repair, enrichment, speech, and dictation token minting. The live and settled budgets are
deliberate separate buckets: a person typing continuously can spend the provisional allowance
without ever touching the allowance their finished sentence needs. Background work cannot spend
either, and a hidden repair is the first thing to shed under load. Admission is chosen from the
validated `mode` after the body is parsed. This protects a single instance; it is not a
deployment-wide abuse defence, and the documentation says so rather than implying otherwise.

## Provider failure UX

A failed translation preserves the draft and the previous good result. The error surface is
translated and offers retry. No raw provider message, status code or stack trace reaches the person.

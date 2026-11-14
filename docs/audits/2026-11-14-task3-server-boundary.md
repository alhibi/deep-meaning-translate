# Task 3 — Server Boundary and Provider Protocol (started 2026-11-14)

Status: **started; F18, F19, F20 and F21 fixed.** Malformed, oversized and cross-origin probes ran
against the production preview. Replay, live provider behaviour and the remaining review items are
**NOT_VERIFIED** because no provider key exists in this workspace.

Plan: `docs/superpowers/plans/2026-11-14-deep-audit.md` (Task 3).

## F18 — invalid input spent the translation allowance (P2)

**Symptom.** The raw API routes called `takeToken` before reading or validating the body. A burst of
malformed requests drained the client's bucket, so the next valid request was refused with `429`,
and an oversized body could be reported as rate limiting instead of bad input.

**Evidence (RED, production preview, no provider key).** 70 malformed same-origin `POST`s to
`/api/translate-stream`:

```
     61 400
      9 429
```

The next valid request returned `429 {"ok":false,"kind":"rate"}`. A 200 KB body also returned `429`
because the bucket was already empty.

**Root cause.** `takeToken(clientAddress(request))` ran before `boundedJson` and `StreamInput.parse`
in `translate-stream.ts`, `speak.ts` and `eleven-speak.ts`. The limiter therefore counted requests
that could never reach a provider.

**Fix.** `src/lib/requestSafety.ts` now exports `parseAdmittedJson(request, schema, take, maxBytes)`:
it bounds and parses the body first, returns `input` without calling `take`, and spends admission
only for a schema-valid body. All three routes use it, preserving their existing 429/`Retry-After`
mapping. The body is bounded (default 96 KB) before admission, so parsing cannot be unbounded; that
trade-off is deliberate — a malformed request must not cost budget.

**Tests.** Two new cases in `src/lib/requestSafety.test.ts`: malformed and oversized bodies leave the
admission call count at 0; a valid body spends exactly once and a spent budget reports `rate`.

**Evidence (GREEN, same preview).**

| Probe | Result |
| --- | --- |
| 70 malformed same-origin POSTs | **70 × 400**, no 429 |
| 200 KB body | **400** |
| valid request immediately after them | **502** (auth, no key), not 429 |
| 70 valid requests | 60 × 502, then 10 × 429 |
| 429 headers | `Retry-After: 2` |

## F19 — a provider body could enter an internal error message (P2)

**Observation (source).** The OpenCode and DeepSeek `send()` helpers appended
`body.slice(0, 200)` to `TranslationError("provider", …)`. No current route returns that message —
they return only `{ ok: false, kind }` — but global handlers log `Error` objects (`src/server.ts`,
`src/start.ts`), and a provider body can echo the private input text. Carrying it was unnecessary
risk.

**Fix.** Both providers cancel the provider body and throw with the status only:
`Provider responded 500` / `DeepSeek responded 500`. The client-visible classification is unchanged.

**Test.** `src/lib/translation/providers/request.test.ts` returns a 500 whose body is
`SECRET private sentence`; the provider rejects with `kind: "provider"` and a message that does not
contain that body. The live provider path remains **NOT_VERIFIED** (no key).

## F20 — dictation token minting had no budget (P2)

`assemblyToken` required only same-origin, then minted a short-lived AssemblyAI token with the
server key. Replaying it as fast as the network allowed could mint unlimited tokens and spend the
provider's quota, while every other paid endpoint already had a purpose bucket.

**Fix.** `takeDictationToken = createLimiter(20, 0.5)` in `throttle.ts`, applied after the
same-origin check. A refused call returns `{ ok: false, status: 429 }` with a calm message. The
shared limiter is unit-tested; this wiring is source-verified and its live call is
**NOT_VERIFIED** (no way to invoke the server function directly in this workspace).

## F21 — AssemblyAI error text reached the user (P2)

On a failed provider response, `assemblyToken` parsed `data.error` and returned it as `message`.
`useAssemblySpeech` passes `session.message` to its failure state, and the translator renders that
message, so a raw provider error body was client-visible.

**Fix.** The provider body is cancelled, only the status is logged, and the returned message is
`AssemblyAI is unavailable right now.`; the status is kept for diagnostics. Source-verified; a live
provider failure is **NOT_VERIFIED** without a key.

## Replay inspection

| Surface | Replay result | Evidence |
| --- | --- | --- |
| `POST /api/translate-stream`, malformed | 70 replays → 70×400; no token spent | runtime |
| `POST /api/translate-stream`, valid | 60×502, then 10×429; each replay is a new provider attempt bounded by `takeToken` | runtime |
| `POST /api/speak`, valid | 40×503, then 5×429 with `Retry-After: 5` | runtime |
| `POST /api/eleven-speak`, valid | 40×503, then 5×429 with `Retry-After: 5` | runtime |
| `GET` warm-ups | 20×204; allow/deny share one status, bounded by `takeWarmToken` | runtime + source |
| `assemblyToken` | new `takeDictationToken` (20 burst / 0.5 s) | source; live call NOT_VERIFIED |
| server fns `translate`, `repairTranslation`, `analyzeShadow`, `lookupLexicon` | `takeToken`, `takeRepairToken`, `takeEnrichmentToken` | source |

The app has no accounts and no state-mutating replay side effect: a replayed translation or speech
request is a new paid call, and the purpose bucket bounds the cost. There is deliberately no
idempotency key; adding one would cache private text server-side.

## Duplicate verification review

`verifyTranslation` has a single implementation in `src/lib/translation/verify.ts`. Its call sites
are distinct, not copies:

| Call site | Purpose |
| --- | --- |
| `engine.runTranslation` | issues for the non-streaming server function |
| `engine.runRepair` | verifies the previous result to build the repair prompt, then verifies the candidate to compare issue counts (intentional second call) |
| `engine.runReview` | rejects a review that introduces any issue |
| `useTranslator` (streamed full reply) | parses the streamed JSON client-side and computes `needsRepair`; the server cannot verify before the stream ends |
| `routes/lab.tsx` | development-only inspection |

Conclusion: one algorithm, two transports (server function and streamed client parse) sharing the
same pure function. There is no duplicate implementation to merge, and the repair path's second
call is required for the before/after comparison.

## Verified during this pass

| Invariant | Evidence |
| --- | --- |
| A stream without a completion event is rejected | `providers/stream.test.ts`: premature EOF and an error envelope after text both reject; `[DONE]` (even without a final newline) and `response.completed` succeed |
| Cross-origin browser requests are rejected | `Origin: https://evil.example` → **403** |
| Oversized bodies are rejected without a provider call | 200 KB → **400** |
| The allowance still exists and reports retry time | 60 valid requests → 502, then 429 with `Retry-After: 2`; speech routes set 5 (source) |
| Per-purpose buckets | `takeToken`, `takeWarmToken`, `takeRepairToken`, `takeEnrichmentToken`, `takeSpeechToken` are separate limiters |
| No text or key in the response | error bodies are `{ ok: false, kind }`; logs carry event/outcome/ms/chars only |

### Missing `Origin`

`sameOrigin()` accepts a request with no `Origin` (and no `Sec-Fetch-Site: cross-site`). Probed with
curl: malformed → 400, valid → 502. This is intentional for non-browser clients; browsers send
`Origin` on cross-origin POSTs, and the app has no accounts or cookies to ride. It is not a CSRF
bypass in this product.

### `X-Forwarded-For` (open, TD15)

`clientAddress()` prefers `CF-Connecting-IP`, then `X-Real-IP`, then the first
`X-Forwarded-For` entry. With 70 valid requests carrying a rotated `X-Forwarded-For`, **all 70
returned 502 and none 429** — a client can mint a fresh bucket whenever no trusted edge header is
present. On Cloudflare the edge sets `CF-Connecting-IP`; the preview server does not. Recorded as
TD15, not fixed here.

## Remaining Task 3 work

- Provider-key paths — auth/quota/network classification, real SSE, `Retry-After` pass-through from
  a provider — are **NOT_VERIFIED** without keys.
- A live `assemblyToken` call and a live provider failure were not exercised; both are
  source-verified only.

## Commands run

```
npx vitest run src/lib/requestSafety.test.ts \
  src/lib/translation/providers/request.test.ts \
  src/lib/translation/providers/stream.test.ts   # 15 passed
npm run typecheck                                # exit 0
npm run lint -- --max-warnings 0                 # exit 0
npm run build                                    # exit 0
npm run check:pwa                                # exit 0 (37 files)
curl probes against npm run preview              # tables above
# replay: 45 valid /api/speak and /api/eleven-speak on fresh servers
#        -> 40×503 then 5×429 each; Retry-After present
```

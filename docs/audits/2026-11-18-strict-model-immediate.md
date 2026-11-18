# Strict Model Selection and Immediate Translation — 2026-11-18

Status: **Executed**; production verification recorded in §5 after publication. Classifications follow
[testing](../quality/testing.md).

## 0. Request and design decision

The owner asked for two coupled guarantees:

1. when a model is selected, the translation must be produced **by that model only** — no switching
   to the other model, no waiting for a substitute;
2. translation must be generated **immediately when text is entered**, without an artificial pause.

The implemented design:

- **Strict writer.** `brain` is the only provider; the stream route makes one attempt on it
  (`maxAttempts: 1`), never falls back, never cools down into the other writer and never retries
  automatically. A refusal is a calm, retryable error.
- **One immediate full request.** Every foreground translation is a single structured stream with the
  selected model (translation first in the JSON); the committed answer is parsed and verified in the
  same pass. There is no provisional live request, no second "settled" request and no pause upgrade.
  The first meaningful input of a draft, a paste/share and any model/parameter change are sent at
  **0 ms**; only later typing is coalesced by the adaptive delay (with a first-request latch, so a
  keystroke cannot start a full request each time — see §1).
- **Model switch.** Selecting a different model clears the displayed answer immediately (no text from
  the previous model remains under the new selection) and starts a full request through the new
  model.
- **No cross-model review.** DeepSeek no longer reviews Luna-written sentences and no other model may
  edit the selected model's output. A deterministic issue triggers one quiet repair through the
  **same** model.
- **Corrected OpenCode routing session.** The OpenCode gateway validates a `ses_`-shaped session id;
  the old static `lingua-translator` value had the wrong shape. Each provider request now carries a
  fresh valid id plus the documented companion header. The prompt cache key stays stable.
- **Admission** follows the new reality: the foreground full-request bucket is 180 burst / 4 per
  second (a continuous fast typist), the live bucket is kept only for the salvage stream.

## 1. What the first implementation got wrong (and how it was measured)

The first version made "immediate" mean *every* keystroke. A production-bundle browser trace of a
44-character Arabic sentence showed **39 full provider requests** in one sentence (one per typed
character, each aborted by the next) before the final answer. The cause was the scheduler treating
"no result yet and no in-flight request" as first-input on every render, after the key-change block
had already aborted and nulled the previous request.

Fix: an `immediateNext` latch is reset only when the draft becomes empty, the model/parameters
change, or a request fails; after the first uncoalesced request, later typing uses the adaptive
delay. The same trace after the fix showed **4** requests (text lengths 2, 18, 38, 44) and the final
full answer; the first visible text arrived in 0.89 s and the settled answer at 1.13 s on the local
production bundle (provider/edge variance moves these numbers).

## 2. Implementation

| Area | Change | Files |
| ---- | ------ | ----- |
| Server | strict single-writer route; one attempt; no fallback, cooldown, fallback header or auto retry; same-model salvage | `src/lib/translation/streamRoute.server.ts` |
| Engine | `providerFor(brain)` only; strict translation and same-model repair; cross-model review removed | `src/lib/translation/engine.server.ts` |
| Provider | OpenCode session id shape + companion header; review functions/profile removed | `providers/opencode.server.ts`, `providers/deepseek.server.ts`, `providers/capabilities.ts` |
| Client | full-only immediate request with first-input latch; model switch clears and re-requests; no auto retry; pause effect removed; immediate full on first input | `src/lib/translation/useTranslator.ts` |
| Admission | foreground bucket 180/4 | `src/lib/translation/throttle.ts` |
| Public copy | `/about` states strict selection and immediate generation in ar/en/de | `src/routes/about.tsx` |
| Tests | strict writer/engine/route tests; immediate and model-switch hook tests; session-id test; removed review expectations | translation test suite |

## 3. Verification

- **Unit/integration**: full suite **1329 passed / 140 files** (no skips). Typecheck, zero-warning
  lint, contrast, docs, security and production build pass.
- **Strict API, built bundle**: Velo full request streams normally; a Sona request with no local key
  returns `502 {kind:"auth"}` in 6 ms and **never calls Velo**.
- **Browser trace, built bundle**: a 44-character no-punctuation sentence sends **4** full requests
  (text lengths 2, 18, 38, 44; the first starts at input, then typing is coalesced), first text at
  0.89–1.02 s and settled at 1.13–1.40 s; the short word settles around 1.2 s. No live/provisional
  request appears.
- **Model switch (browser, built bundle)**: selecting Sona cleared the Velo answer in **50 ms**, sent
  exactly one `luna` full request and **no Velo request and no salvage stream**, and showed the
  auth error for the unconfigured local model. The chip stayed on Sona.
- **No automatic retry**: a rate failure shows the rate state after one request and is still there
  after 5 s with no second call.
- **Error classification**: a 502 auth response now reaches the UI as `auth` (the old code cancelled
  the error body before parsing it and misreported every non-429 failure as `provider`).

## 4. Limits and remaining risk

- **Sona availability is external**: the provider still refuses requests with a rate class (TD54).
  Strict mode means a Sona selection now shows that error rather than Velo's answer — the requested
  behaviour. The corrected session id must be verified against a working OpenCode account.
- **Token cost of full-only typing** is higher than the old cheap live previews; the exact delta is
  TD55, and the admission bucket was sized so a human is never refused.
- **No automatic retry** means a transient network/provider blip shows a retry button instead of
  healing silently. That is deliberate for "immediately, by the chosen model"; offline recovery still
  retries when connectivity returns.
- **Provider/edge variance** remains the dominant part of end-to-end latency on the deployed URL.
- **Android direct-key mode** remains DeepSeek-only; selecting Sona there stays on the service and is
  subject to the provider's availability.

## 5. Production verification

_Pending publication of this commit. The same probes will be recorded here before the audit is marked
production-verified._

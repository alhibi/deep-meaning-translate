# Translation Pipeline

Status: **Verified** by source inspection, unit tests and live DeepSeek calls on 2026-11-16.
Editing/request ownership was rechecked with unit tests and mocked browser streams on 2026-11-17.
Live model output on `deepseek-flash` is verified for the sample set in §11 (accuracy is sampled, not
a corpus claim); Luna and the cloud-voice providers remain **NOT_VERIFIED** (no key in this
environment). Prompt text lives only in `src/lib/translation/prompt.ts`; this document describes its
structure, not a second copy.

## 1. Input and source resolution

- Text is trimmed and normalized for identity; the raw text is preserved for the request.
- The language bar can say `auto` or a concrete code. A local writing-system check
  (`languageCheck.ts`) catches a strong mismatch (e.g. Arabic typed while German is selected):
  the bar keeps the person's choice, but the **request** is sent as `auto` so the model is not
  misled. Same-script mismatches only produce a dismissible hint.
- A detected source equal to the target is rerouted to the partner language instead of producing an
  X→X result. Arabic script with an Arabic target is routed before the first request.

## 2. Scheduling

`useTranslator` is the single owner of request identity and phase. The scheduler:

- normalizes text (`scheduler.ts`) and refuses text that is not worth a request;
- learns from typing intervals to decide whether the current text is provisional;
- waits for a pause, but flushes deliberately on paste/share/restore and after a maximum wait while
  typing never stops;
- invalidates obsolete completions, retries and repairs as soon as draft identity changes, **before**
  waiting for the replacement debounce; an append-only compatible live prefix may keep painting,
  but cannot commit/archive for the newer draft;
- resets the length catch-up guard on deletion, replacement or parameter changes, so a shorter answer
  can paint from its first chunk; returning to a committed draft cancels the intervening request;
- pauses scheduling, the watchdog and explicit submission during IME composition;
- deduplicates a key already on screen or already in flight;
- shows a loading state only after 260 ms; a request times out after 60 s; the in-memory cache holds
  60 entries for 30 minutes.

The canvas has **no manual send button**: typing alone reaches this path. The adaptive debounce
remains 40 ms at a sentence/newline boundary, 90 ms at a soft boundary, 110 ms after whitespace and
240 ms mid-word, with additional patience for fast typing, an initial fragment, long text or a slow
connection. These are client scheduling delays, **not** provider latency promises. Paste and the
IME-safe Enter shortcut can still request a full reading immediately. Removing the button does not
remove composition guards, cancellation, deduplication, retry or the full-reading pause upgrade.

`translationKey(text, source, target, style, dialect, brain)` is the one definition of request
identity; cache, device memory and session priming all use it.

## 3. Two response modes

| Mode             | Request           | Response          | Commitment                                        |
| ---------------- | ----------------- | ----------------- | ------------------------------------------------- |
| Live (`partial`) | while typing      | plain text stream | display only; never verified, stored or archived  |
| Full             | finished sentence | structured JSON   | parsed, verified; eligible for memory and archive |

After a 1,200 ms pause, an unchanged live result requests **one full reading**. It is not made final
by flipping a flag: only that full response can settle it and expose actions. The in-memory cache
records whether a result came from full mode, so an explicit submission cannot be answered by an
unchecked live reading. A throttled live request stays quiet and tries the separate full-mode path
after the pause; further editing cancels it.

The displayed result has its own request key. `stale` means it belongs to another draft (or an IME is
composing); `settled` requires the current key, a non-provisional result and a complete phase.
Session writes, save/swap, dictionary and sentence shadow use that eligibility. A previous result can
stay readable, but its actions are inert, its voice playback stops, and it is never persisted for the
new source. Live metadata starts fresh instead of inheriting an earlier draft's detected language.

## 4. Prompt architecture

`buildSystemPrompt()` establishes the translator's identity and invariants: carry meaning, intent,
tone and register; never add, drop, explain or soften; preserve certainty, politeness, negation,
names, numbers, dates, URLs, emoji and line breaks; render idioms idiomatically; do not invent
gender; keep genuine ambiguity; understand Arabic dialects. It then gives the exact JSON schema.

`buildUserPrompt()` adds the pair, the register guidance and an optional Arabic-variety clause,
then the text inside `<text>` tags. `buildLiveSystemPrompt()` and `buildLiveUserPrompt()` are the
plain-text variants: translation only, no JSON, no completion of a half-typed thought.

The three registers are not labels over one voice: `STYLE_GUIDANCE` gives different German and
Arabic behavior for each (for example `du`/`Sie`, contractions, MSA versus spoken Arabic). The
model is also asked to classify situation and source tags; those are optional metadata.

## 5. Parsing and verification

- `parse.ts` accepts the structured result defensively; malformed output becomes a provider failure,
  never a crash or a half-rendered object.
- `verify.ts` runs deterministic checks: empty output, lost URLs, lost numbers (canonicalized across
  Western and Arabic-Indic digits, including thousands/decimal separators), lost emoji, possibly
  lost names (only outside Arabic pairs), paragraph structure, implausible length ratios, a
  translation-label prefix, an added explanation, a dropped question mark, and Arabic punctuation
  in the wrong direction.
- These checks are intentionally conservative. They cannot judge style or nuance; they catch
  silent factual losses. Human review remains necessary for linguistic quality.

## 6. Repair and review

A settled result with deterministic issues triggers **one** quiet repair pass. The repaired result
is shown only if it clears more issues than it creates. With no deterministic issue, a second brain
may review the sentence; DeepSeek never reviews its own writing, and with Luna paused the review
path is effectively inactive. Repair is not a loop and is not exposed as machinery to the person.

## 7. Memory and archive

- A settled, verified result is written to device translation memory (bounded by rows and bytes,
  with a TTL, validated on read). A later session answers the same key locally with no request.
- Provisional text is never stored.
- History/statistics and saved phrases are separate local stores; statistics are derived, not
  duplicated.
- On boot, a session's result is primed under the session's own pair (ADR 0002), so the first paint
  needs no request.

## 8. Enrichment

Dictionary lookup, Sentence Shadow and second-pass review are background work. They pass through
one queue (`enrichment.ts`): one request at a time, a short gap, a hang timeout, and a rejection
that never blocks the queue. Foreground translation never waits for enrichment.

## 9. Failure states

Offline, timeout, rate limit, auth/quota, provider and validation failures map to distinct phases.
The draft and the last good result stay on screen. A rate-limited live request is silent while
typing. Cancellation is a quiet end, not an error.

Two retry layers, both bounded:

- **Provider boundary (server):** one retry for a transient HTTP status (429/500/502/503/504) or a
  network failure **before the response body is handed off**, with `Retry-After` clamped to 2.5 s
  and 200–600 ms full-jitter otherwise. A caller abort, a 401/402, or a stream that has already
  started is never retried (a started stream cannot be replayed).
- **Client (session):** one retry after a transient `rate`/`network`/`provider` failure, as
  before; a live rate limit stays silent while typing.

If a **full structured** request still fails (the provider cut it, or the JSON cannot be parsed),
the client makes **one** plain live request as a salvage and passes the resulting text through the
deterministic verifier before showing it. Salvaged text is never written to translation memory. If
even the salvage cannot be verified, the calm provider error is shown instead. A silent half-JSON,
a truncated sentence or an invented repetition loop must never become a settled answer.

## 10. Throughput and admission

- Live typing and settled sentences spend **separate** per-client admission buckets. A burst of
  provisional streams cannot starve the finished sentence that follows it, and background repair
  remains a third budget. The buckets are sized so a fast human typist is never admitted-then-refused
  mid-sentence (live 120 / 4 per second sustained; settled 90 / 2 per second); a scripted client is
  still bounded. These are admission limits, not model throttles.
- The warm-up request preloads both provider modules and opens the TLS connection **without text or
  credentials**. The first keystroke therefore does not also pay for module resolution.
- `max_tokens` is a **runaway ceiling, not a target** (`budget.ts`): structured replies use floor
  512, factor 2.6 and ceiling 16,384; live replies use floor 256, factor 1.5 and ceiling 8,192. A
  short sentence always has room to finish, while a pathological generation for a long paste stops
  at a finite ceiling. The provider accepts 16,384 on `deepseek-flash` (probed 2026-11-16), and a
  5,000-character source now produces a complete structured answer (verified end-to-end).
- The stream is only settled by a **protocol completion**: OpenAI `finish_reason` `stop`, or
  Responses `response.completed`. `finish_reason: "length"`, `content_filter`, an unknown reason,
  `response.incomplete` and a premature EOF are provider failures; `[DONE]` can no longer turn a
  cut answer into a success.
- When the writer is DeepSeek and the sentence has no deterministic issue, no repair round trip is
  made: with Luna paused there is no second brain that could change the result. A result with a lost
  number or link still gets its repair.
- A newer stream cancels the older prefix stream as soon as it has caught up on screen, and a
  committed result cancels it immediately; two providers never finish the same sentence.

## 11. Known limits and audit evidence

- Streaming providers may emit partial JSON; only a complete protocol completion is committed. A
  cut full answer is salvaged once as verified plain text, never shown as half-JSON.
- Deterministic verification cannot detect a fluent but semantically wrong sentence.
- Language pairs other than Arabic ⇄ German have no specialized checks or product guarantees.
- Live DeepSeek observations on 2026-11-16 (dev server, real key, no synthetic mocks): two live
  Arabic→German streams returned their first byte in 0.29–0.36 s and completed in 0.68–0.90 s; a
  formal German→Arabic full reply completed in 1.34 s with correct register and tags; a
  2,926-character varied Arabic text produced a valid 4,297-character structured translation in
  5.37 s. The old 4,096-token ceiling truncated a 5,000-character full reply at 13,061 bytes and
  produced invalid JSON; after the budget and anti-repetition prompt fixes the same input produced
  a valid 7,016-character answer in 6.53 s.
- A highly repetitive 5,000-character paste initially drove the model into an 8× repetition loop
  that exhausted the old ceiling. The prompt now mirrors source length and repetition explicitly,
  the ceiling leaves room for a legitimate long answer, and a degenerate loop that still occurs is
  rejected by the verifier before it can be shown.
- Luna is behind `LUNA_ENABLED = false` and no OpenCode key exists in this environment; its paths
  are unit-tested but not live-verified. Cloud voice and dictation likewise remain NOT_VERIFIED.

# Translation Pipeline

Status: **Verified** by source inspection and unit tests on 2026-11-07. Live model output was
**NOT_VERIFIED** (no provider keys). Prompt text lives only in `src/lib/translation/prompt.ts`; this
document describes its structure, not a second copy.

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
- cancels or supersedes older requests, and may let a live stream for a prefix continue so words
  do not disappear;
- deduplicates a key already on screen or already in flight;
- shows a loading state only after 260 ms; a request times out after 60 s; the in-memory cache holds
  60 entries for 30 minutes.

`translationKey(text, source, target, style, dialect, brain)` is the one definition of request
identity; cache, device memory and session priming all use it.

## 3. Two response modes

| Mode | Request | Response | Commitment |
| --- | --- | --- | --- |
| Live (`partial`) | while typing | plain text stream | display only; never verified, stored or archived |
| Full | finished sentence | structured JSON | parsed, verified; eligible for memory and archive |

A live result can settle after a pause; only then does it become a normal result with actions.

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
The draft and the last good result stay on screen. Transient failures retry once. A rate-limited
live request is silent while typing. Cancellation is a quiet end, not an error.

## 10. Known limits

- Streaming providers may emit partial JSON; only a complete protocol completion is committed.
- Deterministic verification cannot detect a fluent but semantically wrong sentence.
- Language pairs other than Arabic ⇄ German have no specialized checks or product guarantees.
- Provider keys were absent in the audit environment, so no end-to-end quality claim is made.

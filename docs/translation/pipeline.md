# Translation Pipeline

Status: **Verified** by source inspection, unit tests and live DeepSeek calls on 2026-11-16.
Editing/request ownership and the enrichment queue were rechecked with unit tests and mocked browser
streams on 2026-11-17; the same day's upgrade rechecked provider task profiles and the
dictionary/shadow analysis paths in source and unit tests, with live capability probes (synthetic
input, key not printed). Live model output on `deepseek-flash` is verified for the sample set in
§11 (accuracy is sampled, not a corpus claim); Luna and the cloud-voice providers remain
**NOT_VERIFIED** (no key in this environment). Translation prompt text lives only in
`src/lib/translation/prompt.ts`; enrichment prompts live beside their parsers
(`lexicon.ts`, `shadow.ts`), as `AGENTS.md` requires.

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

- normalizes text (`scheduler.ts`) and refuses text that is not worth a request; the
  normalization composes Unicode to **NFC** before collapsing whitespace, so canonically equivalent
  input (decomposed German umlauts, Arabic hamza forms) is one request key and one translation-memory
  row rather than two paid requests;
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

After 1,200 ms with no text change, a still-provisional draft requests **one full reading**. The
clock starts at the last text change, not when the live answer arrives: the live request is a
transport detail, and anchoring the pause to it serialised a whole provider round trip into every
settled sentence (measured on the deployed route: the full request left ≈3.2 s after the last
keystroke instead of 1.2 s; see [the latency audit](../audits/2026-11-17-latency.md)). A full
reading is not made final by flipping a flag: only that full response can settle it and expose
actions. The in-memory cache records whether a result came from full mode, so an explicit
submission cannot be answered by an unchecked live reading. A throttled live request stays quiet
and tries the separate full-mode path after the pause; further editing cancels it.

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
is shown only if it clears more issues than it creates. With no deterministic issue, DeepSeek may
review a Luna-written sentence; it never reviews its own writing. The stream response reports the
brain that actually wrote the answer (`X-Translation-Writer`) and the client passes it back as
`writer` on the review, so a DeepSeek fallback that rescued a failed Luna request is not reviewed as
Luna's. A clean DeepSeek result makes no review round trip at all. The
second-pass review is quiet background work: it waits in the same paced queue as the dictionary and
the shadow (§8), with the highest priority because its result can replace the visible sentence.
Repair is not a loop and is not exposed as machinery to the person.

## 7. Memory and archive

- A settled, verified result is written to device translation memory (bounded by rows and bytes,
  with a TTL, validated on read). A later session answers the same key locally with no request.
- Provisional text is never stored.
- History/statistics and saved phrases are separate local stores; statistics are derived, not
  duplicated.
- On boot, a session's result is primed under the session's own pair (ADR 0002), so the first paint
  needs no request.

## 8. Enrichment

Dictionary lookup, Sentence Shadow and second-pass review are quiet background work. They pass
through one queue (`enrichment.ts`): at most one queued task runs at a time, a short (140 ms) gap
only after work that actually reached the network, an 8 s hang timeout that releases the door, and
failure isolation. It is a **bounded priority queue** (review > dictionary > shadow, at most 12 queued):
queued work whose screen or text is gone is skipped **before** any request, running work is
logically aborted, and the second-pass review is in this queue too. Foreground translation never
goes through it, and a hung task cannot block the sentence on screen.

Cancellation is logical, not over the wire: the RPC/native transport functions carry no
`AbortSignal` yet, so a superseded enrichment request can still complete server-side (TD38). Each
analysis call is also bounded by a 45 s provider timeout on the server.

### Dictionary (lexicon v2)

The dictionary is a context-aware lexical reference for the word or short fixed expression the
person wrote. It is model-generated and labelled as such: `source: "model"` is written by the
parser, never by the model, and the UI says "Model reading — not a verified dictionary". It is not
a verified lexicon.

- **Local candidate gate** (`isLexiconCandidate`): at most 96 code points and 10 words; terminal
  punctuation, a newline or a sentence separator refuses the input; beyond four words, a
  pronoun/demonstrative scaffold refuses it; question/request shapes, clause scaffolds,
  conjunctions and bounded finite-verb lists refuse prose, and Arabic strips clitics/prefixes/
  suffixes with dialect awareness. Idioms stay admissible and a four-word floor keeps fixed
  expressions such as "thank you", "على راسي" and "ins kalte Wasser springen". Residual: a nominal
  Arabic sentence can still pass (heuristic limit recorded with the classifier tests; was TD43).
- **Data model and parser:** term, lemma, part of speech, up to 10 entries each with up to 6
  ranked readings (the in-context reading first), a one-sentence definition, labelled forms (up to
  8), synonyms (up to 8),
  collocations (up to 6), labelled nuances (up to 6; `shift | near_synonym | double | idiom |
false_friend`), up to 2 example pairs, pronunciation only when the model is confident, register
  and variety. The parser accepts the older flat shape, drops malformed entries and never throws.
- **Ranking is deterministic, not model order:** the model's short translation of the term selects
  the entry (term/lemma/synonym exact match first, then a reading), then the model's `primary`
  flag, then everyday frequency; inside an entry the reading matching that translation comes first.
- **Server:** `analyzeLexiconFor` is the one path shared by the browser server function and the
  native route. It applies the gate, the enrichment admission bucket and
  `engine.server.runAnalysis` (analysis profile), then echoes the request's register, variety and
  sentence. `lexicon.ts` owns the prompt, schema and parser together; any failure is a quiet
  `null`.
- **Client:** `useLexicon` waits 260 ms after the translation settles, then sends the term,
  direction, style, dialect, UI locale, the model's translation and — when it adds information —
  the full sentence as ranking context. Cache version 2 is keyed by all of those, bounded to 40
  entries with least-recently-used eviction; a stale lookup can never overwrite a newer one.

### Sentence Shadow (v2)

The shadow is a precision pass over a settled translation: what meaning may not have survived. It
must never point at the wrong words and never invent a loss to look active.

- **Vocabulary:** eight categories (`warmth, intensity, respect, humor, ambiguity, culture,
rhythm, implied`) and a `kind` of `loss` (meaning lost) or `weakened` (tone or intensity
  survived, softer). The model may also judge `style`, `normal` or `unclear`; those are filtered out
  before a finding exists, so a reply that mentions only them is the honest, common answer
  "nothing essential lost", which the interface shows.
- **Thresholds and volume:** at least 0.6 confidence for a loss (0.75 for a severity-1 finding)
  and 0.7 for a weakened tone (capped at severity 2); at most 4 findings are shown, strongest
  first, with overlapping target spans deduplicated.
- **Anchoring:** the model only quotes fragments; every offset is recomputed locally. Matching is
  tolerant of case, whitespace and newlines, Arabic harakat and tatweel, Arabic versus Western
  digits, composed versus decomposed German (NFC) and edge punctuation, but never of different
  words. Quote occurrences are paired to target occurrences using the model's occurrence hints,
  relative position in the two texts, and a monotonic filter; a finding that cannot be anchored in
  both texts is dropped.
- **Long text:** the whole 5,000-unit source is accepted and split into sentence-aligned,
  overlapping windows with absolute offsets and ±240 characters of neighbouring context. A plan is
  built under **one explicit budget** (`SHADOW_MAX_REQUESTS` = 4 requests, ≤64,000 prompt
  characters, ≤262,144 output tokens, 65,536 per call): the planner measures real prompts and lowers
  depth (larger windows), never coverage, to fit. One 45 s deadline and the caller's signal cover
  the analysis. A failed window is isolated: surviving findings merge and are marked `incomplete`;
  a partial answer with no finding stays `null` rather than claiming "nothing lost". Splitting is
  abbreviation/decimal/date-safe; merge dedupes by target **and** source overlap with global
  monotonic order. The translation side is bounded at 15,000 units. Live long-text cost/quality
  remains NOT_VERIFIED (TD41).
- **Restores:** an alternative is shown only if it keeps every number, URL and emoji of the current
  translation, uses the target language's script, changes only part of the sentence (never a full
  rewrite) and actually touches the lost words; the smallest changes are offered first (at most
  3). Apply previews a word-level diff before changing anything, keeps the untouched findings
  visible while the edited sentence is re-checked, updates history and a saved phrase, and offers
  Undo until the draft or the checked translation changes.
- **Server:** `analyzeShadowFor` is the one path shared by the browser server function and the
  native route; the prompt, window plan and parser live together in `shadow.ts`, and the text is
  produced by `runAnalysis` with the analysis profile. Every failure is a quiet `null`.

## 9. Failure states

Offline, timeout, rate limit, auth/quota, provider and validation failures map to distinct phases.
The draft and the last good result stay on screen. A rate-limited live request is silent while
typing. Cancellation is a quiet end, not an error: the client's abort also cancels the response
reader, so a body that never sends another chunk cannot keep a dead request alive, and a cancelled
request is never retried or salvaged.

Two retry layers, both bounded:

- **Provider boundary (server):** one retry for a transient HTTP status (429/500/502/503/504) or a
  network failure **before the response body is handed off**, with `Retry-After` clamped to 2.5 s
  and 200–600 ms full-jitter otherwise. A caller abort, a 401/402, or a stream that has already
  started is never retried (a started stream cannot be replayed). **On the foreground stream route,
  the writer that starts makes one attempt when a usable alternate waits behind it**
  (`maxAttempts: 1`) instead of sleeping through `Retry-After` for a provider that is already
  refusing the request; the last usable writer keeps the bounded retry, and a single-writer
  deployment always keeps it.
- **Provider cooldown:** a writer that just failed is skipped for a bounded window — rate 30 s,
  network 10 s, provider 15 s, auth/quota 5 min — while the other writer can answer; a success
  clears the record. The response reports the actual writer and, when a rescue happened, the
  failure class in `X-Translation-Fallback`; the server log records `requested`, `fallback` and
  `upstreamMs` without any text. State is two bounded process-local entries, like the admission
  buckets.
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
- The warm-up request preloads both provider modules, the shared engine and the request types, in
  parallel, and opens the TLS connection **without text or credentials**. The first keystroke
  therefore does not also pay for serial module resolution. The same four imports inside the
  request handler load together rather than one after the other.
- `max_tokens` is a **runaway ceiling, not a target**, and it is set **per task class** in
  `providers/capabilities.ts`: live streams 8,192 / settled full 16,384 / repair and review 32,768 /
  analysis 65,536, all under the documented 384K provider output bound. `budget.ts` still supplies
  the plain-answer floor and factor (structured floor 512, factor 2.6; live floor 256, factor 1.5),
  and a reasoning class only raises that ceiling. Thinking is explicit per class because the API
  defaults it **on** with high effort: live and full keep it off for latency, repair, review and
  analysis opt in (effort high/max). A live probe on 2026-11-17 showed reasoning tokens are charged
  against `max_tokens` (with `max_tokens: 10` and thinking on, the provider returned
  `finish_reason: "length"`, ten completion tokens all as reasoning, and an empty answer), so the
  reasoning ceilings sit well above the plain answer they must also contain.
- The provider's **protocol completion is the contract for streaming and non-streaming replies**
  (`providers/completion.ts`): OpenAI `finish_reason` (`stop` is the only success; `length`,
  `content_filter`, `tool_calls`, an unknown reason and a missing reason are provider errors) and
  Responses `response.completed` / `response.incomplete`. `[DONE]` cannot turn a cut answer into a
  success, a truncated non-streaming reply is classified as a provider error instead of a parse
  accident, and the server chat path, the native buffered fallback and the direct repair path all
  call the same check; `direct.ts` mirrors the streaming rule for the personal-key path.
- Long input never splits. `assertContextFits` compares a pessimistic three-tokens-per-character
  source plus prompt overhead and the output ceiling with the documented 1M-token context **before**
  any fetch; the app's own 5,000-character schema leaves large headroom, and an input that could not
  fit is a loud `input` error rather than a truncation or a chunker.
- When the writer is DeepSeek and the sentence has no deterministic issue, no repair round trip is
  made: DeepSeek never reviews its own writing. A clean Luna-written sentence gets exactly one
  DeepSeek review. A result with a lost number or link still gets its repair either way.
- A newer stream cancels the older prefix stream as soon as it has caught up on screen, and a
  committed result cancels it immediately; two providers never finish the same sentence.

## 11. Known limits and audit evidence

- Streaming providers may emit partial JSON; only a complete protocol completion is committed. A
  cut full answer is salvaged once as verified plain text, never shown as half-JSON.
- Deterministic verification cannot detect a fluent but semantically wrong sentence.
- Language pairs other than Arabic ⇄ German have no specialized checks or product guarantees.
- Dictionary readings and shadow findings are model-generated estimates, not a reviewed corpus: the
  tests pin parsing, ranking, anchoring, windowing and restore validation, but linguistic accuracy
  remains sampled (TD1).
- The dictionary gate is heuristic: a nominal Arabic sentence can still pass it, costing one quiet
  request whose model reply is the literal `null`; classifier rules and boundary cases have tests
  in both languages.
- Long-text shadow runs under a bounded plan (≤4 requests, ≤64,000 prompt characters, one 45 s
  deadline). Live long-text cost and finding quality are **NOT_VERIFIED** (TD41).
- Cancellation now reaches the wire: hooks → rpc/transport → fetch/reader → server handler →
  provider, with a quiet 204 for an already-disconnected native client (was TD38/TD40). Verified in
  dev with a real aborted `Request.signal` node test; the deployed Worker runtime and an Android
  WebView socket close are NOT_VERIFIED (TD42/TD17).
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
- Luna is enabled (`LUNA_ENABLED = true`); its live/settled streaming, DeepSeek fallback, DeepSeek
  review and the Android direct-key guard are unit-tested. **Deployed observation 2026-11-17:** the
  OpenCode/Luna writer refused requests throughout the audit window — four of four production
  probes were rescued by DeepSeek after 3.36–4.36 s, and the route named `deepseek` as the actual
  writer — so a live Luna-written answer, its latency and its linguistic quality remain
  **NOT_VERIFIED** (TD54; an unavailable provider is not app code). The route now fails over in one
  attempt and cools the writer down, so a Sona selection cannot queue the person behind a refusing
  provider. Cloud voice and dictation likewise remain NOT_VERIFIED.

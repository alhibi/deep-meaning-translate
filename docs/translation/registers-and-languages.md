# Registers, Dialects and Language Direction

Status: **Verified** in the prompt and request model on 2026-11-07. Linguistic output quality is
**NOT_VERIFIED** without provider keys and human review.

## Registers

| Register | German behavior (instructed) | Arabic behavior (instructed) |
| --- | --- | --- |
| **Natural** | Mirror the source's own register; standard everyday wording; keep the source's `du`/`Sie`; default `du` for chat | Clean modern standard Arabic, light and simple, not stiff |
| **Formal** | Elevated and courteous: `Sie`, full forms, Konjunktiv courtesy, no contractions | Refined فصحى with courtesy (حضرتك، هل بإمكانكم، أكون ممتنًا، تفضّلوا), no dialect |
| **Casual** | Relaxed, how friends text: `du`, everyday contractions, short and loose, no crude slang | Spoken dialect, never فصحى; Levantine unless a variety is chosen; short |

The prompt gives worked examples so the register is audible even in short text. The register is part
of the request key: changing it produces a different request and a different cached result.

## Arabic varieties

`dialect` applies only when Arabic is the target:

- `auto` — follow the source; no explicit variety clause.
- `msa` — Modern Standard Arabic.
- `levant`, `egypt`, `gulf`, `iraq`, `maghreb` — the named regional variety, in Arabic script, as
  people actually speak and text it; formal style adds politeness rather than switching to MSA.

The picker is hidden when Arabic is not the target, and the request normalizes the dialect to
`auto` in that case.

## Source resolution

1. The person's explicit source is a hint.
2. A strong writing-system mismatch is sent as `auto`; the bar still shows the explicit choice and a
   dismissible hint explains it.
3. The model is instructed to report the language the text is **actually** written in; a same-script
   mismatch is refined from the finished result's `sourceLanguage`.
4. If detection equals the target, the app reroutes to the partner language rather than showing an
   identity translation.
5. Arabic script with an Arabic target is routed before the first request.

## Direction-specific rules

- **German → Arabic**: conversational German should become natural, spoken-leaning Arabic rather
  than rigid MSA; gender agreement must be correct; German `du`/`Sie` politeness must survive.
- **Arabic → German**: produce German syntax and cases; particles (`mal`, `doch`, `halt`) only where
  natural; do not become over-formal for casual text.
- Typos, missing letters, hamza/diacritics, swapped letters, Arabizi and `ae/oe/ue/ss` are read as
  the intended word and never mirrored into the output.
- Names, numbers, dates, URLs, emoji and line breaks are preserved exactly.

## Language coverage

The picker offers the designed Arabic ⇄ German pair first and a broad table of more than seventy
languages: European, Middle Eastern, South and East Asian, and further African and Asian
languages with their native names, right-to-left flags, search aliases and localized names from
`Intl.DisplayNames`. Every code is two letters, because the request schema, the session validator,
the archive and the server all store two-letter codes.

The picker groups without hiding: pinned favorites, recent choices, the natural partners of the
current source, the most used languages, then the complete alphabetical list. Search normalizes
case, Latin diacritics and Arabic letter variants (hamza/alef, teh marbuta, tatweel), so
`الألمانية`, `الالمانيه` and `Deutsch` all find German. Favorites and recent choices are device-only,
bounded and validated; a damaged list is dropped, never rendered.

The writing-system check covers the scripts of the offered languages, not only Latin and Arabic,
and distinguishes Urdu, Pashto, Sindhi and Uyghur before falling back to Arabic. A wrong-script
pick still sends `auto` to the model instead of misleading it.

## What the app does not claim

- Equal quality for every language pair. Arabic ⇄ German is the designed pair.
- That `auto` detection is perfect; it is a hint refined by the model and local checks.
- That register selection guarantees a specific dialect; it is guidance to the model, not a
  deterministic transformation.
- That a regional variety is appropriate for every reader; the person chooses it.

## Changing this behavior

Prompt changes belong in `src/lib/translation/prompt.ts` only. After a change:

1. Update this document if the semantics change (not merely wording).
2. Add or update prompt tests (`prompt.test.ts`) for the invariants that can be asserted.
3. Run the evaluation procedure in `docs/translation/evaluation.md` with a human reviewer for both
   directions and all three registers.
4. Do not add a second prompt copy in documentation, a route or a test fixture as a source of truth.

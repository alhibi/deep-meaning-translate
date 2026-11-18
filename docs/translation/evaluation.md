# Translation Quality Evaluation

Status: **Partially verified**. The deterministic layer is tested. Linguistic quality is
**NOT_VERIFIED**: no provider keys were available, and no human-reviewed benchmark was executed in this audit. The model-specific and neutral-Arabic prompt revision has not been tested live or
compared for latency; deterministic prompt tests do not establish translation quality.

## What can be automated

`src/lib/translation/verify.test.ts` and `prompt.test.ts` cover invariants that do not require
judgement:

- numbers survive across Western and Arabic-Indic digits, including thousands/decimal forms;
- URLs, emoji, names (outside Arabic pairs), paragraph structure and question marks survive;
- a label prefix, an added explanation, an implausible length ratio and Arabic punctuation in the
  wrong direction are flagged;
- an empty or malformed structured result is a failure, not a rendered object;
- each register and Arabic variety adds its intended instruction;
- the live prompt asks for plain text only and forbids completing a half-typed thought.

These are necessary, not sufficient. A fluent sentence can still change meaning.

## What requires a human reviewer

Build a small, versioned corpus per direction and register. Each row: source, context (chat / work /
official), expected meaning constraints, unacceptable changes, and a reference translation that is
**one acceptable answer, not the only one**. At minimum include:

| Category | Example risk |
| --- | --- |
| Idioms | literal rendering destroys the image |
| Sarcasm / humor | tone inverted or flattened |
| Politeness (`du`/`Sie`, حضرتك) | social relationship changed |
| Workplace request | imperative becomes rude, or hedging disappears |
| German compounds | meaning split incorrectly |
| Arabic regional expressions | understood as another dialect or as MSA |
| Ambiguous sentence | one reading invented with false certainty |
| Negation | a `nicht`/`لا` lost |
| Dates, quantities, currencies | number preserved but unit or date order changed |
| Names and places | transliterated inconsistently or dropped |
| Technical vocabulary | domain term replaced by a generic word |
| Long text / paragraphs | structure collapsed, content omitted |

Score each row on: meaning preserved, intent preserved, naturalness, register, factual details,
no invention, no omission. Record the reviewer and date. A release claim must name the corpus
version and the number of reviewed rows; "looks good" is not evidence.

## Lab and local experimentation

The repository contains a development-only `/lab` route for prompt experiments. It is not part of
the public product, is not indexed, and is not a substitute for a reviewed benchmark. Do not ship
lab-only controls or mock translations to production.

## Procedure for a prompt/model change

1. Freeze the current corpus version and record a baseline.
2. Run the new prompt on the same rows, both directions, all registers.
3. Have a native reviewer compare blind (no model names) and mark regressions.
4. Run the deterministic suite; no factual-loss regression is acceptable.
5. Record: corpus version, model, prompt commit, reviewer, pass/regression counts, and unresolved
   cases. Update this document's status if the evidence changes.
6. Never claim a quality improvement from a single example or from the model's own opinion.

## Known gaps

- No reviewed corpus is committed, so quality cannot be asserted from the repository alone.
- No automated semantic metric is used; BLEU-style scores would reward literal overlap and are a
  poor fit for meaning-first translation.
- Provider nondeterminism means exact-output tests are inappropriate outside fixtures.
- Dialect quality needs native speakers of each variety; one reviewer cannot certify all of them.
- Cost and latency of a multi-stage pipeline were not measured; the app already performs one repair
  or review pass, and adding more requires evidence, not intuition.

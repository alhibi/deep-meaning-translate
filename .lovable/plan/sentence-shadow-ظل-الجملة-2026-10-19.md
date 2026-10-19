# Sentence Shadow (ظلّ الجملة)

## The idea
Every translation loses some things: warmth, emphasis, respect, humor, ambiguity, cultural weight, rhythm. Sentence Shadow makes that loss **visible and fixable**. Under the finished translation, a faint "shadow" appears: an offset, blurred echo of the sentence. Only the parts that lost something show in it. Tap a dark spot and you see what was lost, why, and one or two ways to get it back. One tap applies a fix to the translation.

It is honest by design. When nothing meaningful was lost, no shadow appears. Every loss comes with a confidence level and is worded as a possibility ("may sound…"), not a verdict.

## What the user sees

```text
 ┌─────────────────────────────────────────┐
 │ Schade, dass es vorbei ist.             │  ← translation (unchanged)
 │   ░░░░░░            ▓▓▓▓▓▓▓             │  ← shadow: offset, blurred echo;
 │                                          │     darker = more meaning lost
 │  ◐ 2 losses · warmth · intensity         │  ← quiet summary line
 └─────────────────────────────────────────┘
```

1. **Arrival.** About 600 ms after the translation settles, the shadow "falls" behind the text: it slides 4 px down and to the reading side (left in Arabic, right in German) and fades in from blur 8 → 3 px, like a light source settling. Nothing appears while you are still typing.
2. **Density.** Each lost part gets its own shade (light / medium / deep) based on how much was lost. Words with no loss stay clear. The shadow uses the theme's surface colors, not the accent color. In the light theme it reads as a soft ink wash, in dark clay as a deeper ember-tinted shade.
3. **Category marks.** A small glyph sits beside each dark spot, drawn as a thin line icon (one color, no emoji): warmth, intensity, respect/formality, humor/irony, ambiguity, cultural reference, rhythm/sound, implied meaning. The summary line names up to three categories.
4. **Touch.** Tapping a dark spot brings that part forward: the shadow lifts and focuses (blur 3 → 0) and a matching underline appears in the source sentence above, so you see which original words produced it. In Arabic↔German, where word order differs, the link follows meaning, not position.
5. **Shadow card** (bottom sheet, same family as the dictionary sheet):
   - **What was lost:** one plain sentence in the app language, e.g. "The exaggerated grief of «يا حسرتاه» became a neutral 'too bad'."
   - **Loss meter:** a short 3-step bar plus confidence ("likely" / "possible").
   - **Ways to restore** (1–3): each shows the changed translation with only the changed words highlighted, a short note on the trade-off ("stronger, but more poetic"), and buttons to hear it and to **Apply**.
   - **Keep as is:** dismisses this loss for this sentence.
6. **Apply.** The translation morphs in place using the existing word animation: only the changed words dissolve and rewrite. The shadow under that part fades, since the loss is restored. The rest of the shadow recalculates quietly. Undo is available for 6 seconds.
7. **Whole-sentence view.** A long press on the summary line opens "Shadow map": source and translation stacked, with soft light bands linking each lost part across the two languages. Read-only and calm, for learning.
8. **Zero-shadow state.** When the translation keeps the meaning, the summary briefly says "Nothing essential lost" with a subtle clear glyph, then fades. No fake findings.

## Behaviour rules
- Runs only on **settled** translations (after typing stops and the final pass finishes), never during streaming. Each analysis is tied to the exact source and translation; a newer translation cancels and ignores an older analysis.
- Applying a fix updates the shown translation, Copy, voice, history entry and saved phrases consistently. Read-along uses the new text.
- On by default with a toggle ("Sentence shadow") in the existing settings area. Off means no requests are made.
- Short inputs (one or two words) skip the shadow; the dictionary covers them.
- Works in all three UI languages and in both directions, with right-to-left handled correctly (the offset direction, underline anchoring and sheet layout all mirror).
- Reduced motion: no slide or blur animation, just instant opacity changes.
- Offline or failed analysis: the shadow quietly does not appear. Never an error blocking the translation.
- Results cached in memory per sentence and settings, so swapping style back and forth does not re-ask.
- Runs on DeepSeek V4.1 Flash, like everything else while Luna is paused.

## Quality and honesty
- Only reports losses that point to exact text in both the source and the translation. Anything that cannot be anchored is dropped.
- At most 4 losses per sentence; low-confidence findings below a threshold are hidden.
- Restore options must be valid translations of the same source, in the selected style and dialect. Each is checked before being shown, and options identical to the current text are dropped.
- A fixed test set of about 30 sentences (idioms, politeness, irony, Levantine/Egyptian dialect, German formal Sie/du, compound nouns, and plain sentences that should yield **zero** shadow) is run against the real model before release. Results are recorded with how many were correct, incorrectly flagged, and missed.

## Technical details
- **Contract** `src/lib/translation/shadow.ts`: Zod schema `ShadowResult { losses: Loss[] }` with `Loss { id, category (8-value enum), severity 1–3, confidence 0–1, sourceSpan {start,end}, targetSpan {start,end}, explanation, restores: {text, changedSpans, note}[] (≤3) }`. A pure validator checks that spans are in range and match quoted fragments, removes duplicates and overlaps, caps the count, applies the confidence floor, and verifies each restore differs from the current text. Unit tests cover each rule.
- **Prompt** `buildShadowPrompt` in `prompt.ts`: compact JSON-only instruction listing the eight categories with one Arabic↔German example each, explicitly allowing an empty result, passing style, dialect and register, and asking for quoted fragments (offsets are recomputed locally from the quotes, not trusted from the model).
- **Server** `src/lib/translation/shadow.functions.ts`: `createServerFn` POST, Zod input (source ≤ 600 chars, translation, langs, style, dialect, uiLocale), the existing throttle, DeepSeek key read inside the handler, timeout and abort tied to the caller, returns `null` on any failure. Nothing is logged with user text.
- **Hook** `useShadow.ts`: runs after the settle signal from `useTranslator`, tracks the request generation, keeps an in-memory LRU cache, cancels on text, language, style or brain change, exposes `apply(lossId, restoreIdx)` and `undo()`. Apply goes through the translator's existing "replace result" path so history, Copy, saved phrases and voice stay in sync (the voice prefetch is invalidated).
- **UI** `components/translator/SentenceShadow.tsx` (layer under the result text, reusing `streamingTokens` tokenization for span-to-word mapping), `ShadowSheet.tsx`, `ShadowMap.tsx`, and source-underline support in the input area. Styling uses new semantic tokens in `styles.css` (`--shadow-ink-1..3`, `--shadow-offset`, `--shadow-blur`) defined for both themes, with no gradients and no new accent colors (themes rule). Icons drawn with lucide line icons.
- **i18n**: all labels, category names and states in ar/en/de.
- **Prefs**: `shadowEnabled` added to the prefs and validated by `parsePrefs` (default true, old stored data migrates safely).
- **Tests**: validator/schema tests, hook tests (stale result ignored, cancel on change, cache hit, apply/undo keeps history and Copy consistent), ResultPanel test (no shadow while streaming, zero-shadow state), plus a Playwright e2e `tests/e2e/shadow.py` with a stubbed server response at 424 px and 1280 px in Arabic and German UI (arrival, tap, sheet, apply, undo, reduced motion, no page errors). Done = all unit tests pass, smoke.py shows 0 failures, build OK, and the live 30-sentence evaluation is reported with real numbers.
- **Docs**: an AGENTS.md rule for the shadow contract (local re-anchoring, settled-only, single apply path), and a memory entry for the feature.

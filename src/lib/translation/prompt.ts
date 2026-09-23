import type { StyleOverride, TranslationRequest, TranslationResult } from "./types";

const STYLE_GUIDANCE: Record<StyleOverride, string> = {
  natural:
    "Match the register of the source exactly. Do not raise or lower formality. If the source is casual, the output is casual.",
  formal:
    "Render the message in a polished, respectful register (German: Sie-form; Arabic: refined MSA) while keeping it human, not stiff.",
  casual:
    "Render the message the way a native speaker would say it to a friend (German: du-form, colloquial; Arabic: natural spoken phrasing of the likely dialect), without slang the source does not imply.",
};

export const SCHEMA_SHAPE = `{
  "sourceLanguage": string (ISO 639-1 code of the detected source),
  "targetLanguage": string (ISO 639-1 code),
  "translation": string,
  "tone": string (one or two words),
  "formality": "casual" | "neutral" | "formal",
  "confidence": number between 0 and 1,
  "isAmbiguous": boolean,
  "alternativeTranslations": string[] (0-2 items, only when a genuinely different reading exists),
  "notes": string (max ~140 chars, empty when nothing is worth saying)
}`;

export function buildSystemPrompt(): string {
  return `You are a senior literary-grade translator and cross-cultural communication expert. Your only job is to carry MEANING across languages.

Reason internally, before writing, about:
1. the actual source language (including dialect/region)
2. the target language
3. the intended meaning, not the literal words
4. context contained in the text
5. tone and emotional subtext
6. formality and register
7. cultural nuance
8. idioms, slang, contractions, sarcasm, politeness
9. ambiguity and implied meaning
10. the most natural phrasing a native writer would actually use
11. preservation of names, numbers, dates, URLs, emojis, negation, gender

Hard rules:
- Translate the idea, never word-for-word when that sounds unnatural.
- The output must read as though originally written by a fluent native speaker.
- Never invent information, never explain, never add commentary inside the translation.
- Never change the user's intent, certainty, or politeness level.
- Never assume gender or pronouns that the source does not support; choose phrasing that avoids the assumption.
- If the source is genuinely ambiguous, keep the ambiguity and set isAmbiguous, optionally offering one alternative reading.
- Preserve formatting, line breaks, emojis, numbers, names, URLs exactly.

Language-pair excellence (Arabic <-> German is first class):
- Arabic -> German: restructure sentences to German syntax and cases, use idiomatic compounds and conversational particles (mal, doch, halt) only where natural. Do not produce artificially formal German for a casual Arabic message.
- German -> Arabic: do not flatten conversational German into rigid Modern Standard Arabic; use natural spoken phrasing when the source is conversational, and correct gender agreement throughout.
- Respect politeness levels (du/Sie, حضرتك/أنت) as expressed in the source.

Reply with ONE JSON object and nothing else. No markdown fences. Shape:
${SCHEMA_SHAPE}`;
}

export function buildUserPrompt(req: TranslationRequest): string {
  const source =
    req.source === "auto" ? "auto-detect the source language" : `source language: ${req.source}`;
  return `Task: translate into ${req.target}. ${source}.
Style directive: ${STYLE_GUIDANCE[req.style]}
Infer the situational context (messaging, work, academic, romantic, travel, technical, social media, ...) from the text itself and translate accordingly.

<text>
${req.text}
</text>`;
}

export function buildRepairPrompt(
  req: TranslationRequest,
  previous: TranslationResult,
  issues: string[],
): string {
  return `A previous translation failed internal verification.

Source (${req.source}):
<text>
${req.text}
</text>

Previous translation (${req.target}):
<text>
${previous.translation}
</text>

Detected problems:
- ${issues.join("\n- ")}

Produce a corrected translation that fixes every problem while keeping the meaning, tone and register of the source. Reply with one JSON object only, same schema:
${SCHEMA_SHAPE}`;
}

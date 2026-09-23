import type { Dialect, StyleOverride, TranslationRequest, TranslationResult } from "./types";

const STYLE_GUIDANCE: Record<StyleOverride, string> = {
  natural: "match the source register exactly",
  formal: "polished and respectful but human (de: Sie; ar: refined MSA)",
  casual: "as a native says it to a friend (de: du; ar: natural spoken phrasing), no added slang",
};

export const SCHEMA_SHAPE = `{"translation":str,"sourceLanguage":iso639-1,"targetLanguage":iso639-1,"tone":1-2 words,"formality":"casual"|"neutral"|"formal","confidence":0-1,"isAmbiguous":bool,"alternativeTranslations":[0-2, only for a truly different reading],"notes":str (<=140 chars, usually ""),"situation":"chat"|"work"|"official"|"general"}`;

export function buildSystemPrompt(): string {
  return `Expert native-level translator. Carry meaning, intent, tone, register and cultural nuance, never literal words; output must read as written by a fluent native.
Rules: never add, drop, explain or soften anything; keep certainty, politeness (du/Sie, أنت/حضرتك), negation and humor/sarcasm; render idioms idiomatically; don't assume unstated gender; keep genuine ambiguity (isAmbiguous); preserve names, numbers, dates, URLs, emojis, line breaks exactly.
ar→de: German syntax and cases, particles (mal/doch/halt) only when natural, not over-formal for casual text. de→ar: conversational German → natural spoken-leaning Arabic, not rigid MSA; correct gender agreement. Understand every Arabic dialect (Levantine, Egyptian, Gulf, Iraqi, Maghrebi) and its idioms, e.g. شلونك/إزيك/كيفك = wie geht's.
situation: chat = personal/friends, work = colleagues/business, official = authorities/letters/formal requests.
Reply ONLY minified JSON, translation first:
${SCHEMA_SHAPE}`;
}

/** Live typing: plain text only — no JSON, no metadata, so the first words arrive fast. */
export function buildLiveSystemPrompt(): string {
  return `Expert native-level translator. Carry meaning, intent, tone, register and cultural nuance, never literal words; read as a fluent native wrote it.
Never add, drop, explain or soften; keep politeness (du/Sie, أنت/حضرتك), negation, names, numbers, URLs, emojis, line breaks. Understand every Arabic dialect.
The writer is still typing: translate only what is written, never complete the thought or add a final period.
Reply with the translation text ONLY — no quotes, labels, JSON or commentary.`;
}

export function buildLiveUserPrompt(req: TranslationRequest): string {
  const src = req.source === "auto" ? "auto" : req.source;
  return `${src}→${req.target}; style: ${STYLE_GUIDANCE[req.style]}.${dialectClause(req)}
<text>
${req.text}
</text>`;
}

const PARTIAL_GUIDANCE = `\nStill typing: translate only what is written; never complete the thought or add a final period. Keep alternatives and notes empty.`;

const DIALECT: Record<Exclude<Dialect, "auto">, string> = {
  msa: "Modern Standard Arabic",
  levant: "Levantine (Syrian/Lebanese/Palestinian) Arabic",
  egypt: "Egyptian Arabic",
  gulf: "Gulf (Saudi/Emirati/Kuwaiti) Arabic",
  iraq: "Iraqi Arabic",
  maghreb: "Maghrebi (Moroccan/Algerian/Tunisian) Arabic",
};

function dialectClause(req: TranslationRequest): string {
  if (req.target !== "ar" || !req.dialect || req.dialect === "auto") return "";
  if (req.dialect === "msa") return " Arabic output: Modern Standard Arabic.";
  return ` Arabic output: ${DIALECT[req.dialect]} as people there really speak and text it, in Arabic script${req.style === "formal" ? ", polite and respectful" : ""}.`;
}

export function buildUserPrompt(req: TranslationRequest): string {
  const src = req.source === "auto" ? "auto" : req.source;
  return `${src}→${req.target}; style: ${STYLE_GUIDANCE[req.style]}.${dialectClause(req)}${req.partial ? PARTIAL_GUIDANCE : ""}
<text>
${req.text}
</text>`;
}

export function buildRepairPrompt(
  req: TranslationRequest,
  previous: TranslationResult,
  issues: string[],
): string {
  return `Fix this translation.
Source (${req.source}):
<text>
${req.text}
</text>

Previous translation (${req.target}):
<text>
${previous.translation}
</text>

Problems:
- ${issues.join("\n- ")}

Return the corrected translation, same meaning, tone and register, as minified JSON:
${SCHEMA_SHAPE}`;
}

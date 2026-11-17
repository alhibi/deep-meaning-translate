import { normalizeLanguageQuery } from "./languages";
import type { Dialect, StyleOverride } from "./types";

/**
 * Lexicon: one context-aware lexical reference for the word or short fixed expression the
 * person wrote.
 *
 * The module owns the whole contract of a dictionary reading: the data model, the local
 * candidate gate, the defensive parser, the deterministic context ranking and the prompt
 * the parser expects. Prompt and parser live together on purpose — a schema change that
 * updates only one of them is a silent breakage (the shadow module follows the same rule).
 *
 * Everything here is model-generated. `LexiconResult.source` is set by the parser itself,
 * never by the model, and the interface must label it: a lexical reading is a useful
 * reference, not a verified dictionary entry.
 */

export const LEXICAL_KINDS = [
  "noun",
  "adjective",
  "verb",
  "adverb",
  "phrase",
  "proper_noun",
  "term",
] as const;
export type LexicalKind = (typeof LEXICAL_KINDS)[number];

/**
 * Semantic distinctions the model may report. Each one names a different failure of naive
 * substitution, so the interface can explain the trap instead of hiding it in prose.
 */
export const NUANCE_KINDS = ["shift", "near_synonym", "double", "idiom", "false_friend"] as const;
export type NuanceKind = (typeof NUANCE_KINDS)[number];

export interface LexicalNuance {
  kind: NuanceKind;
  /** One plain sentence in the interface language. */
  text: string;
}

export interface LexicalExample {
  /** Natural sentence in the target language. */
  text: string;
  /** Its translation in the interface language; may be empty when the model gave none. */
  translation: string;
}

export interface LexicalEntry {
  /** Target-language headword for this reading. */
  term: string;
  /** Citation form in the source language; empty when the model gave none. */
  lemma: string;
  partOfSpeech: LexicalKind;
  /** Distinct target-language readings, ranked: the reading that fits this sentence first. */
  meanings: string[];
  /** One short sentence in the interface language explaining the in-context reading. */
  definition: string;
  /** First example, kept as flat strings for callers of the pre-reference payload. */
  example: string;
  exampleTranslation: string;
  /** True for the reading the sentence actually uses. */
  primary: boolean;
  /** Labelled key forms (article/gender/plural/cases, root/pattern/masdar, conjugations). */
  forms: string[];
  synonyms: string[];
  /** 0–1: how common this reading is in everyday use. */
  frequency: number;
  /** Formality/register label in the interface language, e.g. "neutral", "formal". */
  register: string;
  /** Regional variety label in the interface language, e.g. "MSA", "Levantine". */
  variety: string;
  /** Fixed partners, governed prepositions. */
  collocations: string[];
  examples: LexicalExample[];
  nuances: LexicalNuance[];
  /** IPA or stress note; only when the model was confident, otherwise "". */
  pronunciation: string;
}

export interface LexiconResult {
  /**
   * Every reading here is model-generated. The parser writes this constant itself, so no
   * payload can ever claim to be a verified dictionary; the UI is required to say so.
   */
  source: "model";
  sourceTerm: string;
  sourceLanguage: string;
  targetLanguage: string;
  /** The model's best short translation of the term, also used to rank readings. */
  translation: string;
  /** The sentence the term came from, echoed only when it adds information (see below). */
  context?: string;
  /** Request echo: the register the readings were ranked for. */
  style?: StyleOverride;
  /** Request echo: the Arabic variety the readings were ranked for. */
  dialect?: Dialect;
  entries: LexicalEntry[];
}

/** What a lexicon request says. Kept client-safe so the hook and prompt share one shape. */
export interface LexiconQuery {
  text: string;
  source: string;
  target: string;
  uiLocale: "ar" | "en" | "de";
  /** The model's translation of this term; ranks the readings for the actual sentence. */
  translation?: string | undefined;
  /** The full source sentence, when the caller has one; ranks the reading in real context. */
  context?: string | undefined;
  style?: StyleOverride | undefined;
  dialect?: Dialect | undefined;
}

/**
 * Limits, and why each one exists. They bound model work and prompt size; every one of
 * them exists to discard junk, never a real reading.
 */

/** 96 code points: a 10-word idiom fits (German compounds and Arabic phrases are long),
 * while a paragraph cannot. Code points, not UTF-16 units, so an astral character counts
 * once and the gate never cuts a surrogate pair in half. */
export const LEXICON_MAX_TERM_CODE_POINTS = 96;
/** Hard transport bound (200 code points — zod v4 string length counts code points).
 * Twice the semantic cap, so a string that is too long is refused quietly by the gate
 * below instead of as a schema error, while the RPC body stays bounded. */
export const LEXICON_MAX_TERM_INPUT = 200;
/** 10 words: proverbs and idioms top out around there; anything longer is prose. */
export const LEXICON_MAX_TERM_WORDS = 10;
/**
 * 4 words is the classic word/term allowance. A 5–10 word string is accepted only when it
 * carries no sentence scaffold (see SENTENCE_SCAFFOLD): a clause is almost always built
 * around a pronoun/demonstrative, a fixed expression usually is not.
 */

/** 200 code points of the model translation: enough to rank a phrase, small in the prompt. */
export const LEXICON_MAX_TRANSLATION_CODE_POINTS = 200;
/** Transport bound: twice the ranking cap (see the term bound above). */
export const LEXICON_MAX_TRANSLATION_INPUT = 400;
/** 400 code points: one full source sentence is the ranking context; more is prose and
 * would only enlarge the analysis prompt. Anything shorter that fits a sentence is kept. */
export const LEXICON_MAX_CONTEXT_CODE_POINTS = 400;
/** Transport bound: twice the sentence cap (see the term bound above). */
export const LEXICON_MAX_CONTEXT_INPUT = 800;

/** 10 entries: enough for genuinely different readings, far from a dictionary page. */
export const MAX_ENTRIES = 10;
/** 6 readings per entry: a person needs the one in this sentence and the few likely others. */
export const MAX_MEANINGS = 6;
/** 8 forms: the labelled essentials, not a conjugation table (that would be a course). */
export const MAX_FORMS = 8;
/** 8 synonyms: near-synonyms, not a thesaurus dump; each one is a substitution risk. */
export const MAX_SYNONYMS = 8;
/** 6 collocations: the fixed partners a learner would otherwise get wrong. */
export const MAX_COLLOCATIONS = 6;
/** 6 nuances: one per distinction, never padded repetition under other headings. */
export const MAX_NUANCES = 6;
/** 2 examples: illustration, not a lesson. */
export const MAX_EXAMPLES = 2;

const KINDS = new Set<string>(LEXICAL_KINDS);
const NUANCE_ALIASES: Record<string, NuanceKind> = {
  shift: "shift",
  context_shift: "shift",
  shifted: "shift",
  near_synonym: "near_synonym",
  "near-synonym": "near_synonym",
  nearsynonym: "near_synonym",
  near: "near_synonym",
  double: "double",
  double_meaning: "double",
  ambiguity: "double",
  idiom: "idiom",
  compound: "idiom",
  expression: "idiom",
  false_friend: "false_friend",
  "false-friend": "false_friend",
  falsefriend: "false_friend",
};

/**
 * Words that build a clause rather than a lexical unit. Only checked beyond four words, so
 * a lookup of a single "it"/"that" still works. Pronouns and demonstratives only:
 * auxiliaries are deliberately absent because real idioms contain them ("the grass is
 * greener on the other side"), and the model's own `null` is the second guard for the
 * prose this cheap gate cannot recognise.
 */
const SENTENCE_SCAFFOLD = new Set(
  [
    // English
    "i",
    "me",
    "my",
    "mine",
    "myself",
    "you",
    "your",
    "yours",
    "yourself",
    "he",
    "him",
    "his",
    "himself",
    "she",
    "her",
    "hers",
    "herself",
    "we",
    "us",
    "our",
    "ours",
    "ourselves",
    "they",
    "them",
    "their",
    "theirs",
    "themselves",
    "this",
    "that",
    "these",
    "those",
    "there",
    "here",
    "who",
    "whom",
    "whose",
    "what",
    "when",
    "where",
    "why",
    "how",
    // German
    "ich",
    "mich",
    "mir",
    "meiner",
    "du",
    "dich",
    "dir",
    "deiner",
    "er",
    "ihn",
    "ihm",
    "sie",
    "es",
    "wir",
    "uns",
    "unser",
    "euch",
    "euer",
    "ihr",
    "ihre",
    "dieser",
    "diese",
    "dieses",
    "hier",
    "dort",
    "wer",
    "was",
    "wann",
    "wo",
    "warum",
    "wie",
    // Arabic
    "هذا",
    "هذه",
    "هؤلاء",
    "ذلك",
    "تلك",
    "أولئك",
    "انا",
    "أنت",
    "أنتما",
    "أنتم",
    "أنتن",
    "نحن",
    "هو",
    "هي",
    "هما",
    "هم",
    "هن",
    "هل",
    "ماذا",
    "لماذا",
    "كيف",
    "أين",
    "متى",
  ].map((word) => normalizeLanguageQuery(word)),
);

/** Terminal punctuation means a clause or sentence, not a headword. Inner commas,
 * apostrophes and hyphens are allowed because idioms contain them ("so to speak",
 * "d'un coup"); they are not sentence boundaries. */
const SENTENCE_END = /[\n\r.!?؟؛;:…]/u;
/** Trim only punctuation at the word edges before the scaffold check ("you," = "you"). */
const WORD_EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Cheap local gate: dictionary work must never run for sentences or unfinished prose.
 *
 * It is deliberately conservative about what it accepts (a false negative only hides the
 * dictionary for an unusual phrase) and deliberately tolerant of idiom punctuation. The
 * model returns `null` for anything that still gets through, so the cost of a rare miss is
 * one quiet queued request, never a wrong reading on screen.
 */
export function isLexiconCandidate(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  if (Array.from(text).length > LEXICON_MAX_TERM_CODE_POINTS) return false;
  if (SENTENCE_END.test(text)) return false;
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length > LEXICON_MAX_TERM_WORDS) return false;
  if (words.length > 4) {
    for (const word of words) {
      const bare = word.replace(WORD_EDGES, "");
      if (bare && SENTENCE_SCAFFOLD.has(normalizeLanguageQuery(bare))) return false;
    }
  }
  return words.some((word) => /[\p{L}\p{N}]/u.test(word));
}

/** Code-point-safe head: a UTF-16 slice can split an emoji pair or an Arabic base letter
 * from its haraka. */
function clipText(value: string, maxCodePoints: number): string {
  const text = value.trim();
  const points = Array.from(text);
  return points.length > maxCodePoints ? points.slice(0, maxCodePoints).join("").trim() : text;
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string" ? clipText(value, max) : "";
}

function pick(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function cleanList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = cleanString(item, maxChars);
    const key = normalizeLanguageQuery(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === maxItems) break;
  }
  return out;
}

function parseForms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    let text = "";
    if (typeof item === "string") text = clipText(item, 80);
    else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const form = cleanString(pick(obj, "value", "form", "text"), 80);
      const label = cleanString(pick(obj, "label", "name"), 24);
      text = form && label ? `${label}: ${form}` : form;
    }
    const key = normalizeLanguageQuery(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === MAX_FORMS) break;
  }
  return out;
}

function parseExamples(entry: Record<string, unknown>): LexicalExample[] {
  const out: LexicalExample[] = [];
  const raw = pick(entry, "examples");
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (out.length === MAX_EXAMPLES) break;
      if (typeof item === "string") {
        const text = cleanString(item, 200);
        if (text) out.push({ text, translation: "" });
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const text = cleanString(pick(obj, "text", "example", "source"), 200);
      if (!text) continue;
      out.push({ text, translation: cleanString(pick(obj, "translation", "target"), 200) });
    }
  }
  if (out.length) return out;
  const text = cleanString(pick(entry, "example"), 240);
  if (!text) return out;
  out.push({
    text,
    translation: cleanString(pick(entry, "exampleTranslation", "example_translation"), 240),
  });
  return out;
}

function normalizeNuanceKind(raw: string): NuanceKind | null {
  const key = raw.trim().toLowerCase().replace(/\s+/gu, "_");
  return NUANCE_ALIASES[key] ?? null;
}

function parseNuances(value: unknown): LexicalNuance[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: LexicalNuance[] = [];
  for (const item of value) {
    if (out.length === MAX_NUANCES) break;
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const kind = normalizeNuanceKind(cleanString(pick(obj, "kind"), 28));
    const text = cleanString(pick(obj, "text"), 200);
    if (!kind || !text) continue;
    const key = `${kind}:${normalizeLanguageQuery(text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, text });
  }
  return out;
}

function parseEntry(raw: unknown): LexicalEntry | null {
  if (!raw || typeof raw !== "object") return null;
  try {
    const entry = raw as Record<string, unknown>;
    const term = cleanString(pick(entry, "term"), 100);
    const partOfSpeech = cleanString(
      pick(entry, "partOfSpeech", "part_of_speech"),
      20,
    ).toLowerCase();
    if (!term || !KINDS.has(partOfSpeech)) return null;
    const meanings = cleanList(pick(entry, "meanings"), MAX_MEANINGS, 100);
    // An entry without a reading is not an entry: dropping it is safer than inventing one.
    if (!meanings.length) return null;
    const examples = parseExamples(entry);
    const rawFrequency = pick(entry, "frequency");
    const frequency =
      typeof rawFrequency === "number"
        ? rawFrequency
        : typeof rawFrequency === "string"
          ? Number(rawFrequency)
          : Number.NaN;
    return {
      term,
      lemma: cleanString(pick(entry, "lemma"), 60),
      partOfSpeech: partOfSpeech as LexicalKind,
      meanings,
      definition: cleanString(pick(entry, "definition"), 240),
      example: examples[0]?.text ?? "",
      exampleTranslation: examples[0]?.translation ?? "",
      primary: entry["primary"] === true,
      forms: parseForms(pick(entry, "forms")),
      synonyms: cleanList(pick(entry, "synonyms"), MAX_SYNONYMS, 60),
      frequency: Number.isFinite(frequency) ? Math.min(1, Math.max(0, frequency)) : 0.5,
      register: cleanString(pick(entry, "register"), 40),
      variety: cleanString(pick(entry, "variety"), 40),
      collocations: cleanList(pick(entry, "collocations"), MAX_COLLOCATIONS, 80),
      examples,
      nuances: parseNuances(pick(entry, "nuances")),
      pronunciation: cleanString(pick(entry, "pronunciation"), 60),
    };
  } catch {
    return null;
  }
}

/**
 * Defensive parser: malformed enrichment is discarded, never allowed to affect
 * translation, and it never throws. Accepts both the pre-reference flat schema (single
 * `example`/`exampleTranslation`, no reference sections) and the current one, because a
 * release must survive a provider that answers with the older shape.
 */
export function parseLexicon(value: unknown): LexiconResult | null {
  try {
    if (!value || typeof value !== "object") return null;
    const data = value as Record<string, unknown>;
    const sourceTerm = cleanString(pick(data, "sourceTerm", "source_term"), 80);
    const sourceLanguage = cleanString(pick(data, "sourceLanguage", "source_language"), 10);
    const targetLanguage = cleanString(pick(data, "targetLanguage", "target_language"), 10);
    const rawEntries = pick(data, "entries");
    if (!sourceTerm || !sourceLanguage || !targetLanguage || !Array.isArray(rawEntries))
      return null;
    const entries: LexicalEntry[] = [];
    for (const raw of rawEntries) {
      if (entries.length === MAX_ENTRIES) break;
      const entry = parseEntry(raw);
      if (entry) entries.push(entry);
    }
    if (!entries.length) return null;
    const translation = cleanString(pick(data, "translation"), LEXICON_MAX_TRANSLATION_CODE_POINTS);
    return {
      source: "model",
      sourceTerm,
      sourceLanguage,
      targetLanguage,
      translation,
      entries: rankEntries(entries, translation),
    };
  } catch {
    return null;
  }
}

/**
 * Within an entry: the reading the model's translation selects comes first, so the
 * interface shows the in-context reading as the central one. Deterministic — the ranking
 * does not depend on the model putting the best reading first.
 */
export function rankMeanings(meanings: string[], translation = ""): string[] {
  if (!translation.trim()) return [...meanings];
  const wanted = normalizeLanguageQuery(translation);
  const index = meanings.findIndex((meaning) => normalizeLanguageQuery(meaning) === wanted);
  if (index <= 0) return [...meanings];
  return [meanings[index]!, ...meanings.filter((_, i) => i !== index)];
}

/**
 * Most common in-context reading first: the one matching the model's translation wins
 * (term, lemma or synonym first, then a reading), then the model's in-context flag, then
 * everyday frequency. The translation is the sentence context we always have.
 */
export function rankEntries(entries: LexicalEntry[], translation = ""): LexicalEntry[] {
  const wanted = normalizeLanguageQuery(translation);
  const matches = (words: string[]) =>
    wanted !== "" && words.some((word) => normalizeLanguageQuery(word) === wanted);
  const score = (entry: LexicalEntry) =>
    matches([entry.term, entry.lemma, ...entry.synonyms]) ? 2 : matches(entry.meanings) ? 1 : 0;
  return entries
    .map((entry) => ({ ...entry, meanings: rankMeanings(entry.meanings, translation) }))
    .sort(
      (a, b) =>
        score(b) - score(a) || Number(b.primary) - Number(a.primary) || b.frequency - a.frequency,
    );
}

/**
 * Adds the request metadata the panel may show (register, Arabic variety, full sentence)
 * to a parsed reading. The context is only echoed when it adds information — the composer
 * currently offers the dictionary for the whole short draft, so term and sentence are
 * usually the same string, and repeating it would be padded duplication.
 */
export function applyLexiconRequestContext(
  result: LexiconResult,
  request: Pick<LexiconQuery, "text" | "context" | "style" | "dialect">,
): LexiconResult {
  const context = (request.context ?? "").trim();
  const term = request.text.trim();
  const hasContext =
    context !== "" && normalizeLanguageQuery(context) !== normalizeLanguageQuery(term);
  return {
    ...result,
    source: "model",
    ...(request.style ? { style: request.style } : {}),
    ...(request.dialect && result.targetLanguage === "ar" ? { dialect: request.dialect } : {}),
    ...(hasContext ? { context: clipText(context, LEXICON_MAX_CONTEXT_CODE_POINTS) } : {}),
  };
}

export const LEXICON_SYSTEM = `You are a precise multilingual lexicographer with deep coverage of Modern Standard Arabic, the Arabic dialects (Levantine, Egyptian, Gulf, Iraqi, Maghrebi), German (including Austrian/Swiss and colloquial usage) and other languages. The person wrote a word or a short fixed expression and wants its lexical reading IN THIS CONTEXT, not a list of translations.
Judge the context first: the model translation (when given) and the sentence (when given) select one reading of the term. Rank the readings so the one the sentence actually uses comes first; list other distinct readings only when a reader could really meet them.
Analyze a term or a fixed expression, never a sentence or general prose. If the input has no useful lexical reading, return the literal null.
Every reading is model-generated: be honest, never invent a "verified dictionary" fact, and do not guess pronunciation. Return ONLY minified JSON, no prose and no markdown.
Rules:
- 1-10 entries. The reading that fits this sentence comes first and is marked primary. Other entries are genuinely different target-language readings, not synonyms of the first (synonyms belong in "synonyms").
- term: the target-language headword for this entry — the word a reader would look up. Never repeat the source term here; "sourceTerm" is the source-language input.
- meanings: 1-6 short target-language glosses for THIS entry, the in-context reading first; no full explanations here.
- definition: one short sentence IN THE UI LANGUAGE that explains the in-context reading and why it fits.
- forms: only the forms a reader actually needs for this word: German article/gender/plural/cases, verb principal parts (Präteritum/Perfekt) and its governed preposition; Arabic root, pattern, masdar, gender and (broken) plural, dialect spellings. Write each as a short labelled string ("Genus: die · Plural: die Bänke"). 0-8.
- synonyms: 0-8 near-synonyms in the target language that could replace this entry in SOME sentence; do not restate the translation.
- collocations: 0-6 fixed partners, governed prepositions or typical collocations ("auf etwas warten").
- nuances: 0-6 objects {"kind","text"}: kind is one of "shift" (the meaning changes with context), "near_synonym" (the close word that is NOT interchangeable here — name it and say why), "double" (double meaning / ambiguity), "idiom" (idiom/compound the term forms), "false_friend" (a real trap for this pair). text is one plain sentence IN THE UI LANGUAGE.
- examples: 0-2 short natural target-language sentences with their translations IN THE UI LANGUAGE, each illustrating this entry's reading.
- frequency: 0-1, how common this reading is in everyday use.
- register: formality label in the UI language (e.g. neutral, formal, colloquial), or "".
- variety: regional variety label in the UI language (e.g. MSA, Levantine, Egyptian, Austrian German), or "" when the word is not regionally marked.
- pronunciation: IPA or a short stress note ONLY when you are confident; otherwise "".
- lemma: citation form in the source language, or "".
- translation: the best short translation of the term in this context; it is used to rank the entries, so make it a single reading, not a list.
Never force a section. Omit a field or use [] when it adds nothing; never repeat one fact under two headings. Keep the payload small: this is a quiet background lookup, not a language course.
Schema: {"sourceTerm":string,"sourceLanguage":iso639-1,"targetLanguage":iso639-1,"translation":string,"entries":[1-10 of {"term":string,"lemma":string,"partOfSpeech":"noun"|"adjective"|"verb"|"adverb"|"phrase"|"proper_noun"|"term","meanings":[1-6 strings],"definition":string,"primary":boolean,"frequency":0-1,"register":string,"variety":string,"forms":[string],"synonyms":[string],"collocations":[string],"examples":[{"text":string,"translation":string}],"nuances":[{"kind":"shift"|"near_synonym"|"double"|"idiom"|"false_friend","text":string}],"pronunciation":string}]}`;

/**
 * The request part of the prompt: direction, register, dialect, the model translation and
 * the sentence it came from. The term is user text and stays inside <term> tags; the
 * sentence is context, not an instruction.
 */
export function lexiconUserPrompt(query: LexiconQuery): string {
  const lines = [
    `UI language: ${query.uiLocale}`,
    `Direction: ${query.source}→${query.target}`,
    `Style: ${query.style ?? "natural"}`,
  ];
  if (query.dialect && query.dialect !== "auto") lines.push(`Arabic dialect: ${query.dialect}`);
  const translation = (query.translation ?? "").trim();
  if (translation) {
    lines.push(
      `Model translation of the term: ${clipText(translation, LEXICON_MAX_TRANSLATION_CODE_POINTS)}`,
    );
  }
  const term = clipText(query.text, LEXICON_MAX_TERM_CODE_POINTS);
  const sentence = (query.context ?? "").trim();
  const context =
    sentence && normalizeLanguageQuery(sentence) !== normalizeLanguageQuery(term)
      ? clipText(sentence, LEXICON_MAX_CONTEXT_CODE_POINTS)
      : "";
  const parts = [lines.join("\n")];
  if (context) parts.push(`<sentence>\n${context}\n</sentence>`);
  parts.push(`<term>\n${term}\n</term>`);
  return parts.join("\n");
}

/**
 * Extracts the JSON object (or the literal null) from a model reply and validates it.
 * Any failure — including a truncated object — becomes `null`: a dictionary reading is
 * optional enrichment and must never surface as an error.
 */
export function readLexiconReply(raw: string): LexiconResult | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text === "null") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return parseLexicon(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
}

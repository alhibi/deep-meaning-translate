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
 * 4 words is the classic word/term allowance and stays permissive: real lexical units of
 * that length contain pronouns and negations ("thank you", "no worries", "never mind").
 * A 5–10 word string must survive the classifier below, which looks for real sentence
 * evidence instead of guessing from a single word (§ TD43).
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
 * Pronouns, demonstratives and possessives: the subject material of a clause. Checked only
 * beyond four words, so a lexical unit that happens to contain one still works ("thank
 * you", "no worries", "never mind").
 */
const CLAUSE_PRONOUNS = new Set(
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
    // English: the neutral subject/object pronoun was missing from the original scaffold.
    "it",
    "its",
    "itself",
    // German reflexive and possessive forms that carry a subject across a clause.
    "sich",
    "ihnen",
    "mein",
    "meine",
    "meinen",
    "meinem",
    "meiner",
    "meines",
    "dein",
    "deine",
    "deinen",
    "deinem",
    "deiner",
    "deines",
    "sein",
    "seine",
    "seinen",
    "seinem",
    "seiner",
    "seines",
    "ihrem",
    "ihren",
    "ihrer",
    "ihres",
    "unserem",
    "unseren",
    "unserer",
    "unseres",
    "eurem",
    "euren",
    "eurer",
    "eures",
    // Arabic relative pronouns: they open a relative clause, never a headword.
    "الذي",
    "التي",
    "الذين",
    "اللذين",
    "اللتين",
    "اللواتي",
    "اللي",
  ].map((word) => normalizeLanguageQuery(word)),
);

/** Terminal punctuation means a clause or sentence, not a headword. Inner commas,
 * apostrophes and hyphens are allowed because idioms contain them ("so to speak",
 * "d'un coup"); they are not sentence boundaries. */
const SENTENCE_END = /[\n\r.!?؟؛;:…]/u;
/** Trim only punctuation at the word edges before a word-set check ("you," = "you"). */
const WORD_EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
/** Zero-width characters arrive from copy/paste and would hide a space or split a word. */
const INVISIBLE = /[\u200B-\u200F\u2060\uFEFF\u00AD]/gu;

/** A folded word set: case, diacritics and Arabic hamza/alef variants all collapse, so a
 * list written the dictionary way still matches casual spelling ("fällt" / "fallt"). */
function wordSet(...words: string[]): Set<string> {
  return new Set(words.map((word) => normalizeLanguageQuery(word)));
}

/**
 * Wrapping quotes and brackets are display punctuation, never part of the term: «كلمة»,
 * "bank" and (d'un coup) are single lexical units.
 */
const WRAPPERS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ["«", "»"],
  ["“", "”"],
  ["„", "“"],
  ["‘", "’"],
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
];

function stripWrappers(input: string): string {
  let text = input.trim();
  for (let guard = 0; guard < 4; guard++) {
    const first = text[0];
    const last = text[text.length - 1];
    const wrapper = WRAPPERS.find(([open, close]) => open === first && close === last);
    const inner = wrapper ? text.slice(1, -1).trim() : "";
    if (!wrapper || inner.length < 1 || !/[\p{L}\p{N}]/u.test(inner)) return text;
    text = inner;
  }
  return text;
}

/** One normalization for the gate: invisible characters out, wrappers off, NFC, trimmed.
 * Internal whitespace is collapsed later, after the newline check has seen it. */
function normalizeCandidate(raw: string): string {
  return stripWrappers(raw.replace(INVISIBLE, "")).normalize("NFC").trim();
}

/** Edge punctuation is not part of the word; inner punctuation is (hyphens, apostrophes). */
function bareWord(word: string): string {
  return word.replace(WORD_EDGES, "");
}

/** A contracted copula is still a finite verb ("it's", "geht's"): compare without the
 * trailing possessive/contraction "'s". */
function bareLatinWord(word: string): string {
  return bareWord(word).replace(/['’]s$/iu, "");
}

function hasWord(words: readonly string[], set: ReadonlySet<string>, latin: boolean): boolean {
  for (const word of words) {
    const bare = latin ? bareLatinWord(word) : bareWord(word);
    if (bare && set.has(normalizeLanguageQuery(bare))) return true;
  }
  return false;
}

/** A phrase in the folded text on token boundaries: "من فضلك" is one marker, not two words. */
function containsPhrase(foldedText: string, phrase: string): boolean {
  return ` ${foldedText} `.includes(` ${normalizeLanguageQuery(phrase)} `);
}

/**
 * Folded, comma-insensitive key for the fixed-expression list: "wer zuletzt lacht, lacht
 * am besten" matches whether or not the writer typed the comma.
 */
function expressionKey(value: string): string {
  return normalizeLanguageQuery(value).replace(/[,،]/gu, " ").replace(/\s+/gu, " ").trim();
}

/**
 * Finite auxiliaries, copulas and modals. They are the clearest local evidence that a
 * 5–10-word string is a clause ("der Termin wurde verschoben", "the store is closed now").
 * German and Arabic forms are included because the designed pair needs both directions.
 */
const CLAUSE_AUXILIARIES = wordSet(
  // English
  "am",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "having",
  "do",
  "does",
  "did",
  "will",
  "would",
  "shall",
  "should",
  "can",
  "could",
  "may",
  "might",
  "must",
  "ought",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "don't",
  "doesn't",
  "didn't",
  "can't",
  "won't",
  "wouldn't",
  "shouldn't",
  "couldn't",
  "hasn't",
  "haven't",
  "hadn't",
  // German
  "bin",
  "bist",
  "ist",
  "sind",
  "seid",
  "war",
  "waren",
  "wäre",
  "wären",
  "habe",
  "hast",
  "hat",
  "haben",
  "hatte",
  "hatten",
  "wird",
  "werden",
  "wurde",
  "wurden",
  "würde",
  "würden",
  "kann",
  "kannst",
  "können",
  "konnte",
  "konnten",
  "muss",
  "musst",
  "müssen",
  "musste",
  "mussten",
  "soll",
  "sollst",
  "sollen",
  "sollte",
  "sollten",
  "will",
  "willst",
  "wollen",
  "wollte",
  "wollten",
  "darf",
  "darfst",
  "dürfen",
  "durfte",
  "durften",
  "mag",
  "mögen",
  "möchte",
  "möchten",
  // Arabic (MSA + the common dialect copulas)
  "كان",
  "كانت",
  "كانوا",
  "يكون",
  "تكون",
  "نكون",
  "أكون",
  "يصبح",
  "تصبح",
  "أصبح",
  "أصبحت",
  "ظل",
  "ظلت",
  "بقى",
  "بقيت",
  "ليس",
  "ليست",
  "صار",
  "صارت",
  "مازال",
  "مازالت",
  "مش",
  "مو",
  "ما",
);

/** Sentential negation: "ich sehe ihn heute nicht", "there is no time". */
const CLAUSE_NEGATIONS = wordSet(
  "not",
  "no",
  "never",
  "nothing",
  "nobody",
  "none",
  "neither",
  "nor",
  "cannot",
  "nicht",
  "kein",
  "keine",
  "keinen",
  "keinem",
  "keiner",
  "keines",
  "nie",
  "niemals",
  "لا",
  "لم",
  "لن",
  "ليس",
  "ليست",
);

/**
 * Clause conjunctions: two coordinated or subordinated clauses are prose, not a headword
 * ("came home and cooked dinner", "ich kam nach Hause und kochte"). "so", "before", "after",
 * "until" and "من" are deliberately absent: they are prepositions inside real idioms
 * ("so to speak", "the calm before the storm") and nominal phrases ("من فضلك").
 */
const CLAUSE_CONJUNCTIONS = wordSet(
  "and",
  "or",
  "but",
  "because",
  "since",
  "although",
  "though",
  "unless",
  "whereas",
  "whether",
  "if",
  "when",
  "while",
  "yet",
  "und",
  "oder",
  "aber",
  "sondern",
  "denn",
  "weil",
  "wenn",
  "dass",
  "ob",
  "obwohl",
  "während",
  "nachdem",
  "bevor",
  "sobald",
  "falls",
  "als",
  "أو",
  "لكن",
  "بل",
  "لأن",
  "إذا",
  "لو",
  "بينما",
  "عندما",
  "لما",
  "ثم",
  "حتى",
  "كي",
  "لكي",
  "عشان",
  "بس",
);

/**
 * High-frequency finite verb forms (third person singular/past and the common irregulars) in
 * the two languages the product is tuned for, plus English. A finite form in a 5–10-word
 * string with no function word is the last evidence of a clause ("meeting moved to friday
 * morning", "das Treffen findet morgen statt"). Deliberately finite: a missed form costs one
 * quiet request whose documented reply is `null`, never a wrong reading on screen.
 */
const LATIN_FINITE_VERBS = wordSet(
  // English
  "goes",
  "went",
  "comes",
  "came",
  "gives",
  "gave",
  "takes",
  "took",
  "makes",
  "made",
  "knows",
  "knew",
  "sees",
  "saw",
  "says",
  "said",
  "thinks",
  "thought",
  "finds",
  "found",
  "gets",
  "got",
  "puts",
  "tells",
  "told",
  "works",
  "worked",
  "needs",
  "needed",
  "likes",
  "liked",
  "wants",
  "wanted",
  "looks",
  "looked",
  "helps",
  "helped",
  "starts",
  "started",
  "runs",
  "ran",
  "eats",
  "ate",
  "sleeps",
  "slept",
  "speaks",
  "spoke",
  "opens",
  "opened",
  "closes",
  "closed",
  "moves",
  "moved",
  "sends",
  "sent",
  "buys",
  "bought",
  "sells",
  "sold",
  "reads",
  "writes",
  "wrote",
  "plays",
  "played",
  "loses",
  "lost",
  "wins",
  "won",
  "pays",
  "paid",
  "waits",
  "tries",
  "tried",
  "learns",
  "leaves",
  "left",
  "brings",
  "brought",
  "keeps",
  "kept",
  "holds",
  "held",
  "stands",
  "stood",
  "sits",
  "sat",
  "drinks",
  "drank",
  "drives",
  "drove",
  "falls",
  "fell",
  "grows",
  "grew",
  "hears",
  "heard",
  "understands",
  "understood",
  "happens",
  "happened",
  "changes",
  "changed",
  "ends",
  "ended",
  "catches",
  "rises",
  "approved",
  "signed",
  "confirmed",
  "completed",
  "cancelled",
  "discussed",
  "reviewed",
  "reported",
  "delivered",
  "created",
  "deleted",
  "updated",
  "installed",
  "fixed",
  "checked",
  "returned",
  "arrived",
  "departed",
  "called",
  "emailed",
  "messaged",
  // German
  "geht",
  "kommt",
  "macht",
  "gibt",
  "nimmt",
  "sieht",
  "sagt",
  "findet",
  "bleibt",
  "weiß",
  "kennt",
  "braucht",
  "sucht",
  "arbeitet",
  "wohnt",
  "fährt",
  "läuft",
  "isst",
  "trinkt",
  "schläft",
  "spricht",
  "liest",
  "schreibt",
  "kauft",
  "verkauft",
  "spielt",
  "wartet",
  "versucht",
  "lernt",
  "zeigt",
  "bringt",
  "denkt",
  "glaubt",
  "heißt",
  "liegt",
  "steht",
  "sitzt",
  "hängt",
  "fehlt",
  "gefällt",
  "gehört",
  "passiert",
  "funktioniert",
  "beginnt",
  "endet",
  "öffnet",
  "schließt",
  "besucht",
  "trifft",
  "hilft",
  "fragt",
  "antwortet",
  "erklärt",
  "bedeutet",
  "enthält",
  "bekommt",
  "verliert",
  "gewinnt",
  "bezahlt",
  "kostet",
  "dauert",
  "startet",
  "nutzt",
  "ändert",
  "prüft",
  "plant",
  "liebt",
  "hasst",
  "fühlt",
  "verschiebt",
  "verschob",
  "ging",
  "kam",
  "machte",
  "gab",
  "nahm",
  "sah",
  "sagte",
  "fand",
  "blieb",
  "wusste",
  "kannte",
  "brauchte",
  "suchte",
  "arbeitete",
  "wohnte",
  "fuhr",
  "lief",
  "aß",
  "trank",
  "schlief",
  "sprach",
  "las",
  "schrieb",
  "kaufte",
  "spielte",
  "wartete",
  "versuchte",
  "lernte",
  "zeigte",
  "brachte",
  "dachte",
  "hieß",
  "stand",
  "saß",
  "fehlte",
  "gefiel",
  "gehörte",
  "passierte",
  "begann",
  "endete",
  "öffnete",
  "schloss",
  "traf",
  "half",
  "fragte",
  "antwortete",
  "erklärte",
  "bedeutete",
  "bekam",
  "verlor",
  "gewann",
  "bezahlte",
  "kostete",
  "dauerte",
  "startete",
  "nutzte",
  "änderte",
  "prüfte",
  "plante",
  "liebte",
  "hasste",
  "fühlte",
);

/**
 * Arabic verb stems, stripped of subject prefixes/suffixes below. MSA plus the most common
 * dialect stems (قول، روح، شوف، خذ، عطى, ...) so a dialect sentence is recognised as a
 * sentence even when its spelling is not MSA. The stem list is a cost gate, not a
 * morphology reference: a missed stem only means one quiet request.
 */
const ARABIC_VERB_STEMS = wordSet(
  "كتب",
  "ذهب",
  "قال",
  "كان",
  "أكل",
  "شرب",
  "عمل",
  "درس",
  "لعب",
  "قرأ",
  "سمع",
  "رأى",
  "فتح",
  "جلس",
  "نام",
  "قام",
  "جاء",
  "رجع",
  "خرج",
  "دخل",
  "سافر",
  "وصل",
  "وجد",
  "أخذ",
  "أعطى",
  "باع",
  "اشترى",
  "فهم",
  "عرف",
  "ساعد",
  "انتظر",
  "بدأ",
  "انتهى",
  "حاول",
  "أراد",
  "احتاج",
  "سكن",
  "زار",
  "اتصل",
  "سأل",
  "أجاب",
  "تحدث",
  "تكلم",
  "طبخ",
  "نظف",
  "غسل",
  "ركب",
  "نزل",
  "طلع",
  "عاش",
  "بات",
  "فات",
  "مات",
  "صار",
  "ظل",
  "بقى",
  // Dialect stems written the way speakers type them.
  "قول",
  "روح",
  "شوف",
  "خذ",
  "عطى",
  "درى",
  "حكى",
  "سوى",
);

/**
 * Question openers. Only strings longer than two words are refused, so "why not", "how
 * come" and "wie geht's" remain lookups while "where are we going" is a question.
 */
const QUESTION_OPENERS = wordSet(
  "what",
  "why",
  "how",
  "when",
  "where",
  "who",
  "whom",
  "whose",
  "which",
  "wer",
  "was",
  "wie",
  "wo",
  "wann",
  "warum",
  "wieso",
  "weshalb",
  "wohin",
  "woher",
  "welcher",
  "welche",
  "welches",
  "wem",
  "wen",
  "هل",
  "ماذا",
  "لماذا",
  "كيف",
  "أين",
  "متى",
  "أي",
  "كم",
  "شو",
  "ليش",
  "وين",
  "إيمتى",
  "منو",
);

/** German/English yes-no questions start with a finite auxiliary followed by its subject:
 * "Can you help", "Kannst du schwimmen". The subject check keeps "can opener" a candidate. */
const QUESTION_AUX_OPENERS = wordSet(
  "is",
  "are",
  "was",
  "were",
  "am",
  "do",
  "does",
  "did",
  "can",
  "could",
  "will",
  "would",
  "should",
  "may",
  "might",
  "have",
  "has",
  "bin",
  "bist",
  "ist",
  "sind",
  "seid",
  "habe",
  "hast",
  "hat",
  "haben",
  "hatte",
  "hatten",
  "kann",
  "kannst",
  "können",
  "muss",
  "musst",
  "müssen",
  "soll",
  "sollst",
  "sollen",
  "will",
  "willst",
  "wollen",
  "darf",
  "darfst",
  "dürfen",
  "mag",
  "möchte",
);

/** Question subjects include "das", which is also a definite article. */
const QUESTION_SUBJECTS = new Set([
  ...CLAUSE_PRONOUNS,
  ...wordSet("das", "هذا", "هذه", "ذلك", "تلك", "هؤلاء"),
]);

/** Politeness markers make a multi-word request, not a lookup ("send the file please"). */
const REQUEST_MARKERS = [
  "please",
  "pls",
  "plz",
  "bitte",
  "bitte schön",
  "bitte sehr",
  "من فضلك",
  "من فضلكم",
  "لو سمحت",
  "لو سمحتي",
  "رجاء",
  "أرجوك",
  "أرجوكم",
];

/**
 * Fixed expressions whose surface shape is a clause but whose unit is lexical. Exact
 * folded matching keeps well-known proverbs admissible without teaching the cheap local
 * classifier any semantics. The list is a reviewed corpus, not a dictionary: a missing
 * idiom is hidden from the dictionary (never shown as a wrong reading), and the model's
 * own `null` remains the second guard.
 */
const FIXED_EXPRESSIONS = new Set(
  [
    // English
    "the early bird catches the worm",
    "the grass is greener on the other side",
    "what goes around comes around",
    "every cloud has a silver lining",
    "when in rome do as the romans do",
    "it is what it is",
    "there is no place like home",
    "how are you",
    "do it yourself",
    "no time like the present",
    "no rest for the wicked",
    "all that glitters is not gold",
    "you reap what you sow",
    "strike while the iron is hot",
    "look before you leap",
    // German
    "der apfel fällt nicht weit vom stamm",
    "wer zuletzt lacht, lacht am besten",
    "morgenstund hat gold im mund",
    "das ist nicht mein bier",
    "der frühe vogel fängt den wurm",
    "wo gehobelt wird, fallen späne",
    "es ist noch kein meister vom himmel gefallen",
    "man soll den tag nicht vor dem abend loben",
    "was du heute kannst besorgen, das verschiebe nicht auf morgen",
    // Arabic (MSA and Levantine/Iraqi proverbs)
    "خير الكلام ما قل ودل",
    "من حفر حفرة لأخيه وقع فيها",
    "اللي فات مات",
    "رب ضارة نافعة",
    "الصبر مفتاح الفرج",
    "الطيور على أشكالها تقع",
    "إن مع العسر يسرا",
    "على راسي",
  ].map((expression) => expressionKey(expression)),
);

/**
 * Finite-verb detection for Arabic tokens without a POS model: strip the conjunction
 * clitics, the imperfect subject prefixes and the subject suffixes, then look the remaining
 * stem up. "ذهبت" → ذهب, "يكتب" → كتب, "بيقول" (dialect) → قول, "كتاب" stays a noun because
 * no strip yields a listed stem. A wrong stem only hides a phrase from the dictionary.
 */
const ARABIC_CLITICS = ["", "و", "ف", "ب", "ل"];
const ARABIC_PREFIXES = ["", "ي", "ت", "ن", "ا"];
const ARABIC_SUFFIXES = [
  "",
  "ت",
  "تم",
  "تما",
  "تن",
  "نا",
  "وا",
  "ون",
  "ين",
  "ان",
  "ها",
  "هم",
  "هن",
  "كم",
  "كن",
  "ني",
];

function looksLikeArabicVerb(raw: string): boolean {
  const token = normalizeLanguageQuery(raw);
  if (!token) return false;
  for (const clitic of ARABIC_CLITICS) {
    if (clitic) {
      if (!token.startsWith(clitic)) continue;
      const body = token.slice(clitic.length);
      if (body.length < 3) continue;
      if (looksLikeArabicVerbBody(body)) return true;
    } else if (looksLikeArabicVerbBody(token)) return true;
  }
  return false;
}

function looksLikeArabicVerbBody(body: string): boolean {
  for (const prefix of ARABIC_PREFIXES) {
    if (prefix && !body.startsWith(prefix)) continue;
    const withoutPrefix = prefix ? body.slice(prefix.length) : body;
    if (withoutPrefix.length < 2) continue;
    for (const suffix of ARABIC_SUFFIXES) {
      if (suffix && !withoutPrefix.endsWith(suffix)) continue;
      const stem = suffix ? withoutPrefix.slice(0, -suffix.length) : withoutPrefix;
      if (stem.length >= 2 && ARABIC_VERB_STEMS.has(stem)) return true;
    }
  }
  return false;
}

/**
 * Why a string is not a dictionary candidate. Exported with the classifier so the gate is
 * explainable in tests and traceable in a future diagnostic — never a second model call.
 */
export type LexiconCandidateRejection =
  | "empty"
  | "too_long"
  | "sentence_punctuation"
  | "too_many_words"
  | "no_letters"
  | "question"
  | "request"
  | "clause_scaffold"
  | "multi_clause"
  | "sentence_shape";

export type LexiconCandidateVerdict =
  { accepted: true } | { accepted: false; reason: LexiconCandidateRejection };

/**
 * Local candidate classifier (TD43). Decides, without a second model call, whether a string
 * may become a dictionary request. The rules run in this order and the first rejection wins:
 *
 * 1. "empty" — nothing but whitespace.
 * 2. "too_long" — over 96 code points (code points, so an astral character counts once).
 * 3. "sentence_punctuation" — a sentence-end mark anywhere: "word.", "Was ist das?",
 *    "هل هذا صحيح؟". Inner commas, apostrophes and hyphens stay allowed ("so to speak",
 *    "d'un coup"), and wrapping quotes/brackets are stripped first ("«كلمة»" is a word).
 * 4. "too_many_words" — over 10 words: "a bird in the hand is worth two in the bush".
 * 5. "no_letters" — symbols only: "!!! ***".
 * 6. A known fixed expression is accepted before any prose rule ("der Apfel fällt nicht
 *    weit vom Stamm", "the early bird catches the worm", "خير الكلام ما قل ودل").
 * 7. "question" — more than two words starting with a question word, or with a yes/no
 *    auxiliary followed by its subject: "where are we going", "Can you help me",
 *    "Kannst du schwimmen", "هل هذا صحيح". One/two-word lookups stay candidates
 *    ("why not", "wie geht's").
 * 8. "request" — more than two words containing a politeness marker: "send the file
 *    please", "bitte senden sie die datei", "أرسل الملف من فضلك".
 * 9. "clause_scaffold" — beyond four words, a pronoun/demonstrative/possessive, an
 *    auxiliary/copula/modal or a negation: "this is a long text about many words",
 *    "der Termin wurde auf Freitag verschoben", "ich sehe ihn heute nicht".
 * 10. "multi_clause" — beyond four words, a clause conjunction: "came home and cooked
 *    dinner", "ich kam nach Hause und kochte".
 * 11. "sentence_shape" — beyond four words, a finite verb form: "meeting moved to friday
 *    morning", "das Treffen findet morgen statt", "ذهبت إلى السوق صباح اليوم".
 * 12. Otherwise accepted: words, names, compounds, short terms, verb-phrase idioms ("ins
 *    kalte Wasser springen") and proverbs of four words or fewer ("اللي فات مات").
 *
 * The four-word floor is deliberate: "thank you", "no worries", "never mind" and "ins kalte
 * Wasser" are lexical units that contain pronoun, negation or verb, and the product's
 * documented contract keeps short units permissive. This is a cheap local classifier, not a
 * grammar: an Arabic nominal sentence without a pronoun, verb or conjunction ("الجو جميل
 * اليوم") still passes and costs one quiet request whose documented reply is `null`.
 */
export function classifyLexiconCandidate(raw: string): LexiconCandidateVerdict {
  const text = normalizeCandidate(raw);
  if (!text) return { accepted: false, reason: "empty" };
  if (Array.from(text).length > LEXICON_MAX_TERM_CODE_POINTS) {
    return { accepted: false, reason: "too_long" };
  }
  // Phrase rules work on one collapsed line; the newline check still sees the original.
  const line = text.replace(/\s+/gu, " ");
  const words = line.split(" ").filter(Boolean);
  if (words.length > LEXICON_MAX_TERM_WORDS) return { accepted: false, reason: "too_many_words" };
  if (!words.some((word) => /[\p{L}\p{N}]/u.test(word))) {
    return { accepted: false, reason: "no_letters" };
  }
  if (SENTENCE_END.test(text)) return { accepted: false, reason: "sentence_punctuation" };
  const folded = normalizeLanguageQuery(line);
  if (FIXED_EXPRESSIONS.has(expressionKey(line))) return { accepted: true };
  const first = words[0] ?? "";
  if (words.length > 2) {
    if (QUESTION_OPENERS.has(normalizeLanguageQuery(bareWord(first)))) {
      return { accepted: false, reason: "question" };
    }
    const second = words[1] ?? "";
    if (
      QUESTION_AUX_OPENERS.has(normalizeLanguageQuery(bareLatinWord(first))) &&
      QUESTION_SUBJECTS.has(normalizeLanguageQuery(bareLatinWord(second)))
    ) {
      return { accepted: false, reason: "question" };
    }
    if (REQUEST_MARKERS.some((marker) => containsPhrase(folded, marker))) {
      return { accepted: false, reason: "request" };
    }
  }
  if (words.length > 4) {
    if (
      hasWord(words, CLAUSE_PRONOUNS, true) ||
      hasWord(words, CLAUSE_AUXILIARIES, true) ||
      hasWord(words, CLAUSE_NEGATIONS, true)
    ) {
      return { accepted: false, reason: "clause_scaffold" };
    }
    if (hasWord(words, CLAUSE_CONJUNCTIONS, true)) {
      return { accepted: false, reason: "multi_clause" };
    }
    for (const word of words) {
      const bare = bareWord(word);
      if (!bare) continue;
      if (/[\p{Script=Latin}]/u.test(bare)) {
        if (LATIN_FINITE_VERBS.has(normalizeLanguageQuery(bareLatinWord(word)))) {
          return { accepted: false, reason: "sentence_shape" };
        }
      } else if (looksLikeArabicVerb(bare)) {
        return { accepted: false, reason: "sentence_shape" };
      }
    }
  }
  return { accepted: true };
}

/**
 * Boolean form of the classifier used by the hook and the server. False means: do not spend
 * a quiet dictionary request on this text. A false negative only hides the dictionary for an
 * unusual phrase; the model's own `null` is still the second guard for anything missed.
 */
export function isLexiconCandidate(raw: string): boolean {
  return classifyLexiconCandidate(raw).accepted;
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

/**
 * The writing system a language uses, when the integrity guard knows it. Only the pair the
 * product is designed and tested for (Arabic ⇄ German) plus the English UI are guarded; a
 * pair this table does not know is never silently filtered.
 */
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;
const LATIN_SCRIPT = /\p{Script=Latin}/u;
/** Three-letter ISO 639-2 codes a provider may return instead of ISO 639-1. */
const LANGUAGE_ALIASES: Record<string, string> = {
  ara: "ar",
  arb: "ar",
  deu: "de",
  ger: "de",
  eng: "en",
  fra: "fr",
  fre: "fr",
  spa: "es",
  ita: "it",
  tur: "tr",
  rus: "ru",
  zho: "zh",
  chi: "zh",
  hin: "hi",
  fas: "fa",
  per: "fa",
  urd: "ur",
  por: "pt",
  nld: "nl",
  dut: "nl",
  pol: "pl",
  ukr: "uk",
  jpn: "ja",
  kor: "ko",
};

function normalizeLanguageCode(raw: string): string {
  const code = raw.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(code)) return code;
  return LANGUAGE_ALIASES[code] ?? "";
}

export type LanguageScript = "arabic" | "latin";

function expectedScript(code: string): LanguageScript | null {
  if (code === "ar" || code === "fa" || code === "ur") return "arabic";
  if (code === "de" || code === "en") return "latin";
  return null;
}

function scriptCounts(value: string): { arabic: number; latin: number } {
  let arabic = 0;
  let latin = 0;
  for (const char of value) {
    if (ARABIC_SCRIPT.test(char)) arabic++;
    else if (LATIN_SCRIPT.test(char)) latin++;
  }
  return { arabic, latin };
}

/** True when the value is predominantly written in the expected script. A pair this module
 * does not guard (null) accepts anything, so unverified languages are never damaged. */
function inScript(value: string, script: LanguageScript | null): boolean {
  if (!script || !value.trim()) return true;
  const counts = scriptCounts(value);
  return script === "arabic" ? counts.arabic > counts.latin : counts.latin > counts.arabic;
}

const sameText = (a: string, b: string) => normalizeLanguageQuery(a) === normalizeLanguageQuery(b);

/**
 * Non-answers that must never render as a dictionary reading. Folded and punctuation-free,
 * so "N/A", "n/a." and "غير معروف." all disappear before the panel can show them as a fact.
 */
const JUNK_READINGS = new Set(
  [
    "unknown",
    "n/a",
    "na",
    "none",
    "null",
    "nil",
    "not available",
    "no data",
    "-",
    "–",
    "—",
    "?",
    "؟",
    "غير معروف",
    "غير معروفة",
    "غير محدد",
    "لا يوجد",
    "لا اعرف",
    "لا نعرف",
    "مجهول",
    "غير واضح",
    "unbekannt",
    "keine angabe",
    "keine ahnung",
    "nicht bekannt",
  ].map((value) => normalizeLanguageQuery(value.replace(/[.،,;:!?؟]+$/gu, "").trim())),
);

function isJunkReading(value: string): boolean {
  const key = normalizeLanguageQuery(value.replace(/[.،,;:!?؟]+$/gu, "").trim());
  return key === "" || JUNK_READINGS.has(key);
}

/** The authoritative direction and the term the person actually wrote. */
interface LexiconLanguages {
  sourceTerm: string;
  sourceLanguage: string;
  targetLanguage: string;
}

/**
 * A citation form must belong to the source language and be a real word, never a junk
 * placeholder or a transliteration of the target reading. The English citation "to" is
 * dropped because British dictionaries write infinitives with it.
 */
function normalizeLemma(
  value: string,
  sourceLanguage: string,
  sourceScript: LanguageScript | null,
): string {
  let lemma = value.trim();
  if (!lemma || isJunkReading(lemma)) return "";
  if (sourceLanguage === "en") lemma = lemma.replace(/^to\s+/iu, "").trim();
  if (!inScript(lemma, sourceScript)) return "";
  return clipText(lemma, 60);
}

/**
 * Language-integrity and junk filter for one parsed entry. The model may answer for the
 * wrong direction, echo the source headword as the target reading, or pad a list with
 * "unknown"; none of that may ever render as a fact. A rejected entry is dropped, never
 * displayed with a warning: the panel shows a smaller honest reading or nothing.
 */
function sanitizeEntry(entry: LexicalEntry, languages: LexiconLanguages): LexicalEntry | null {
  const targetScript = expectedScript(languages.targetLanguage);
  const sourceScript = expectedScript(languages.sourceLanguage);
  const crossScript =
    targetScript !== null && sourceScript !== null && targetScript !== sourceScript;
  // Only across scripts is an identical string proof of a source-language echo: en→de may
  // legitimately share a headword ("Computer"), ar→de never does.
  const echoesSource = (value: string) => crossScript && sameText(value, languages.sourceTerm);
  if (
    !inScript(entry.term, targetScript) ||
    isJunkReading(entry.term) ||
    echoesSource(entry.term)
  ) {
    return null;
  }
  const readings = (values: string[]) =>
    values.filter(
      (value) => inScript(value, targetScript) && !isJunkReading(value) && !echoesSource(value),
    );
  const meanings = readings(entry.meanings);
  // An entry without a reading is not an entry: dropping it is safer than inventing one.
  if (!meanings.length) return null;
  const examples = entry.examples
    .filter((example) => inScript(example.text, targetScript) && !isJunkReading(example.text))
    .filter((example) => !sameText(example.text, entry.term))
    .map((example) => ({
      text: example.text,
      translation: sameText(example.text, example.translation) ? "" : example.translation,
    }))
    .filter(
      (example, index, list) =>
        list.findIndex((other) => sameText(other.text, example.text)) === index,
    )
    .slice(0, MAX_EXAMPLES);
  return {
    ...entry,
    lemma: normalizeLemma(entry.lemma, languages.sourceLanguage, sourceScript),
    meanings,
    definition: isJunkReading(entry.definition) ? "" : entry.definition,
    example: examples[0]?.text ?? "",
    exampleTranslation: examples[0]?.translation ?? "",
    forms: entry.forms,
    synonyms: readings(entry.synonyms),
    collocations: readings(entry.collocations),
    examples,
    nuances: entry.nuances.filter(
      (nuance) => !isJunkReading(nuance.text) && nuance.text.trim().length >= 4,
    ),
  };
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
      // A labelled pair is the reference shape ("Genus: die · Plural: die Bänke"); the
      // parser joins it so one renderer shows strings without knowing the model's nesting.
      text = form && label ? `${label}: ${form}` : form;
    }
    const key = normalizeLanguageQuery(text);
    // A form without a letter or digit is punctuation the model used as a placeholder.
    if (!text || !/[\p{L}\p{N}]/u.test(text) || seen.has(key)) continue;
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

function parseEntry(raw: unknown, languages: LexiconLanguages): LexicalEntry | null {
  if (!raw || typeof raw !== "object") return null;
  try {
    const entry = raw as Record<string, unknown>;
    const term = cleanString(pick(entry, "term"), 100);
    const partOfSpeech = cleanString(
      pick(entry, "partOfSpeech", "part_of_speech"),
      20,
    ).toLowerCase();
    if (!term || !KINDS.has(partOfSpeech)) return null;
    const rawFrequency = pick(entry, "frequency");
    const frequency =
      typeof rawFrequency === "number"
        ? rawFrequency
        : typeof rawFrequency === "string"
          ? Number(rawFrequency)
          : Number.NaN;
    return sanitizeEntry(
      {
        term,
        lemma: cleanString(pick(entry, "lemma"), 60),
        partOfSpeech: partOfSpeech as LexicalKind,
        meanings: cleanList(pick(entry, "meanings"), MAX_MEANINGS, 100),
        definition: cleanString(pick(entry, "definition"), 240),
        example: "",
        exampleTranslation: "",
        primary: entry["primary"] === true,
        forms: parseForms(pick(entry, "forms")),
        synonyms: cleanList(pick(entry, "synonyms"), MAX_SYNONYMS, 60),
        frequency: Number.isFinite(frequency) ? Math.min(1, Math.max(0, frequency)) : 0.5,
        register: cleanString(pick(entry, "register"), 40),
        variety: cleanString(pick(entry, "variety"), 40),
        collocations: cleanList(pick(entry, "collocations"), MAX_COLLOCATIONS, 80),
        examples: parseExamples(entry),
        nuances: parseNuances(pick(entry, "nuances")),
        pronunciation: cleanString(pick(entry, "pronunciation"), 60),
      },
      languages,
    );
  } catch {
    return null;
  }
}

/**
 * Defensive parser: malformed enrichment is discarded, never allowed to affect
 * translation, and it never throws. Accepts both the pre-reference flat schema (single
 * `example`/`exampleTranslation`, no reference sections) and the current one, because a
 * release must survive a provider that answers with the older shape.
 *
 * It is also the first integrity gate: the language codes are normalized, every entry is
 * checked against the direction it claims (see sanitizeEntry) and non-answer readings are
 * removed, so junk can never reach the panel as a fact.
 */
export function parseLexicon(value: unknown): LexiconResult | null {
  try {
    if (!value || typeof value !== "object") return null;
    const data = value as Record<string, unknown>;
    const sourceTerm = cleanString(pick(data, "sourceTerm", "source_term"), 80);
    const sourceLanguage = normalizeLanguageCode(
      cleanString(pick(data, "sourceLanguage", "source_language"), 10),
    );
    const targetLanguage = normalizeLanguageCode(
      cleanString(pick(data, "targetLanguage", "target_language"), 10),
    );
    const rawEntries = pick(data, "entries");
    if (!sourceTerm || !sourceLanguage || !targetLanguage || !Array.isArray(rawEntries)) {
      return null;
    }
    const languages: LexiconLanguages = { sourceTerm, sourceLanguage, targetLanguage };
    const entries: LexicalEntry[] = [];
    const seenTerms = new Set<string>();
    for (const raw of rawEntries) {
      if (entries.length === MAX_ENTRIES) break;
      const entry = parseEntry(raw, languages);
      if (!entry) continue;
      const key = `${normalizeLanguageQuery(entry.term)}:${entry.partOfSpeech}`;
      if (seenTerms.has(key)) continue;
      seenTerms.add(key);
      entries.push(entry);
    }
    if (!entries.length) return null;
    const targetScript = expectedScript(targetLanguage);
    let translation = cleanString(pick(data, "translation"), LEXICON_MAX_TRANSLATION_CODE_POINTS);
    if (isJunkReading(translation) || !inScript(translation, targetScript)) translation = "";
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

/** Folded word list for partial ranking matches (apostrophes stay inside words). */
function foldWords(value: string): string[] {
  return normalizeLanguageQuery(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * How strongly one piece of the reading matches the model's translation of the term:
 * 3 = the same text, 2 = one contains the other, 1 = they share a content word, 0 = none.
 * Folded, so harakat/hamza and German case distinctions do not hide the in-context reading
 * ("ضفة النهر" / "ضفة", "Bänke" / "bank"). Containment needs at least two letters so a
 * one-letter coincidence cannot reorder a reading.
 */
function readingScore(value: string, wanted: string): number {
  if (!wanted || !value.trim()) return 0;
  const folded = normalizeLanguageQuery(value);
  if (folded === wanted) return 3;
  if (
    folded.length >= 2 &&
    wanted.length >= 2 &&
    (folded.includes(wanted) || wanted.includes(folded))
  ) {
    return 2;
  }
  const words = new Set(foldWords(value));
  return foldWords(wanted).some((word) => words.has(word)) ? 1 : 0;
}

/**
 * Within an entry: the reading the model's translation selects comes first, so the
 * interface shows the in-context reading as the central one. Deterministic — the ranking
 * does not depend on the model putting the best reading first.
 */
export function rankMeanings(meanings: string[], translation = ""): string[] {
  if (!translation.trim()) return [...meanings];
  const wanted = normalizeLanguageQuery(translation);
  return meanings
    .map((meaning, index) => ({ meaning, index, score: readingScore(meaning, wanted) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.meaning);
}

/**
 * Most common in-context reading first: the entry the model's translation points at wins
 * (exact headword, then exact synonym, then a contained headword, then an exact reading,
 * then a partial one), then the model's in-context flag, then everyday frequency. The
 * translation is the sentence context we always have, and a contained reading counts so a
 * phrase translation ("to take the bus") still selects its headword ("take").
 */
export function rankEntries(entries: LexicalEntry[], translation = ""): LexicalEntry[] {
  const wanted = normalizeLanguageQuery(translation);
  const best = (values: string[]) =>
    values.reduce((max, value) => Math.max(max, readingScore(value, wanted)), 0);
  const score = (entry: LexicalEntry) => {
    const head = Math.max(readingScore(entry.term, wanted), readingScore(entry.lemma, wanted));
    const synonym = best(entry.synonyms);
    const meaning = best(entry.meanings);
    if (head === 3) return 5;
    if (synonym === 3) return 4;
    if (head === 2) return 3;
    if (meaning === 3) return 2;
    if (synonym === 2 || meaning === 2) return 1;
    return meaning === 1 ? 0.5 : 0;
  };
  return entries
    .map((entry, index) => ({ entry, index, score: score(entry) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.entry.primary) - Number(a.entry.primary) ||
        b.entry.frequency - a.entry.frequency ||
        a.index - b.index,
    )
    .map((item) => ({
      ...item.entry,
      meanings: rankMeanings(item.entry.meanings, translation),
    }));
}

/**
 * Adds the request metadata the panel may show (register, Arabic variety, full sentence) to
 * a parsed reading, and applies the request as the final integrity authority: the term the
 * person wrote, the direction they chose and the UI locale are never invented by the model.
 * An entry that only made sense for the model's own claimed pair is dropped here, so the
 * panel can never render target-language analysis for a source term. Returns null when
 * nothing survives — the caller shows the quiet empty state, never a wrong reading.
 *
 * The context is only echoed when it adds information — the composer currently offers the
 * dictionary for the whole short draft, so term and sentence are usually the same string,
 * and repeating it would be padded duplication.
 */
export function applyLexiconRequestContext(
  result: LexiconResult,
  request: Pick<LexiconQuery, "text" | "context" | "style" | "dialect" | "source" | "target">,
): LexiconResult | null {
  const sourceLanguage = request.source === "auto" ? result.sourceLanguage : request.source;
  const targetLanguage = request.target;
  const sourceTerm = clipText(request.text.trim(), 80);
  const languages: LexiconLanguages = { sourceTerm, sourceLanguage, targetLanguage };
  // The request's language pair is authoritative; if the model answered for another pair the
  // language check below drops those entries instead of relabelling them.
  const entries: LexicalEntry[] = [];
  const seenTerms = new Set<string>();
  for (const entry of result.entries) {
    const sanitized = sanitizeEntry(entry, languages);
    if (!sanitized) continue;
    const key = `${normalizeLanguageQuery(sanitized.term)}:${sanitized.partOfSpeech}`;
    if (seenTerms.has(key)) continue;
    seenTerms.add(key);
    entries.push(sanitized);
  }
  if (!entries.length) return null;
  const targetScript = expectedScript(targetLanguage);
  let translation = result.translation;
  if (isJunkReading(translation) || !inScript(translation, targetScript)) translation = "";
  const context = (request.context ?? "").trim();
  const hasContext = context !== "" && !sameText(context, sourceTerm);
  return {
    ...result,
    source: "model",
    sourceTerm,
    sourceLanguage,
    targetLanguage,
    translation,
    entries: rankEntries(entries, translation),
    ...(request.style ? { style: request.style } : {}),
    ...(request.dialect && targetLanguage === "ar" ? { dialect: request.dialect } : {}),
    ...(hasContext ? { context: clipText(context, LEXICON_MAX_CONTEXT_CODE_POINTS) } : {}),
  };
}

export const LEXICON_SYSTEM = `You are a precise multilingual lexicographer with deep coverage of Modern Standard Arabic, the Arabic dialects (Levantine, Egyptian, Gulf, Iraqi, Maghrebi), German (including Austrian/Swiss and colloquial usage) and other languages. The person wrote a word or a short fixed expression and wants its lexical reading IN THIS CONTEXT, not a list of translations.
Scope first: the input must be a word or a fixed expression. If it is a sentence, a clause, a question, general prose or a fragment of a message, return the literal null — do not summarize, explain or translate a sentence.
Language integrity: sourceTerm is exactly the person's term in the SOURCE language; term, meanings, synonyms and collocations are in the TARGET language; definition, nuances and example translations are in the UI language; example sentences are in the TARGET language. Never analyze the source term as if it were the target word, and never answer for a different language pair than the requested one. When the source language is "auto", detect it and report it in sourceLanguage.
Reading the term: the term may be an inflected form (German case, number or tense), a separable verb ("mache die Tür auf"), a dialect spelling, Arabizi transliteration (e.g. "3ala rasi") or written without hamza. Resolve it to its citation form first, then judge the reading.
- lemma: the source-language citation form of the exact word used. German verbs resolve to the infinitive and a separable verb keeps its prefix ("aufmachen", not "machen"); German nouns resolve to the nominative singular. Arabic dialect, Arabizi and missing-hamza spellings resolve to the Modern Standard Arabic citation form, while the dialect spelling is recorded in "forms" or "variety". Use "" when you are not sure — never guess a lemma.
Context: the model translation (when given) and the sentence (when given) select one reading of the term. Rank the readings so the one the sentence actually uses comes first; list other distinct readings only when a reader could really meet them. For an inflected term, rank the readings of its citation form.
Every reading is model-generated: be honest, never invent a "verified dictionary" fact, and do not guess pronunciation. Return ONLY minified JSON, no prose and no markdown.
Rules:
- 1-10 entries. The reading that fits this sentence comes first and is marked primary. Other entries are genuinely different target-language readings, not synonyms of the first (synonyms belong in "synonyms").
- term: the target-language headword for this entry — the word a reader would look up. Never repeat the source term here; "sourceTerm" is the source-language input.
- meanings: 1-6 short target-language glosses for THIS entry, the in-context reading first; no full explanations here, and no "unknown", "n/a" or "none" placeholders.
- definition: one short sentence IN THE UI LANGUAGE that explains the in-context reading and why it fits.
- forms: the grammatical forms a reader needs for the looked-up word, written as short labelled strings in the UI language. For a German word: genus and article ("Genus: die"), plural ("Plural: die Bänke"), the cases that matter, and for verbs Infinitiv, Präteritum, Perfekt plus the governed preposition with its case ("Präposition: auf + Akkusativ"). For an Arabic word: root ("جذر: ك-ت-ب"), pattern ("وزن: فِعْل"), masdar, gender, singular and plural, and the dialect spelling when relevant. Never list the target-language headword as a form of the source word. 0-8.
- synonyms: 0-8 near-synonyms in the target language that could replace this entry in SOME sentence; do not restate the translation, and do not list a word that is only loosely related.
- collocations: 0-6 fixed partners in the target language, governed prepositions or typical collocations for this entry ("auf etwas warten", "يتحدث عن"). Do not repeat synonyms.
- nuances: 0-6 objects {"kind","text"}: kind is one of "shift" (the meaning changes with context), "near_synonym" (name the close word that is NOT interchangeable here and say why, naming the sentence or situation where it fails), "double" (double meaning / ambiguity), "idiom" (idiom/compound the term forms), "false_friend" (a real trap for this pair). text is one plain sentence IN THE UI LANGUAGE. Never write a generic "similar meaning" note.
- examples: 0-2 short natural TARGET-language sentences (about 5-14 words) with their translations IN THE UI LANGUAGE, each illustrating this entry's reading. Use everyday language, not textbook filler; never reuse the term as the whole example, and never write an example in the source or UI language.
- frequency: 0-1, how common this reading is in everyday use.
- register: formality label in the UI language (e.g. neutral, formal, colloquial), or "".
- variety: regional variety label in the UI language (e.g. MSA, Levantine, Egyptian, Austrian German), or "" when the word is not regionally marked.
- pronunciation: IPA or a short stress note ONLY when you are confident; otherwise "".
- translation: the best short translation of the term in this context; it is used to rank the entries, so make it a single reading in the target language, not a list.
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
  // The dictionary must survive a term the person typed before the language was detected.
  if (query.source === "auto") {
    lines.push("Source language: detect it from the term and report it in sourceLanguage.");
  }
  // Inflected/dialect/Arabizi spellings are resolved by the model, never by a second call.
  lines.push("Resolve inflections, dialect spellings and Arabizi to the citation form first.");
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

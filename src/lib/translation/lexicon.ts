export type LexicalKind =
  "noun" | "adjective" | "verb" | "adverb" | "phrase" | "proper_noun" | "term";

export interface LexicalEntry {
  term: string;
  partOfSpeech: LexicalKind;
  meanings: string[];
  definition: string;
  example: string;
  exampleTranslation: string;
  primary: boolean;
  /** Inflections / variants: plural, gender, conjugations, dialect spellings. */
  forms: string[];
  synonyms: string[];
  /** 0–1: how common this reading is in everyday use. */
  frequency: number;
  /** Dialect or register tag, e.g. "الشامية", "umgangssprachlich". */
  register: string;
}

export interface LexiconResult {
  sourceTerm: string;
  sourceLanguage: string;
  targetLanguage: string;
  /** The model's main translation, used to rank meanings. */
  translation?: string;
  entries: LexicalEntry[];
}

const KINDS = new Set<LexicalKind>([
  "noun",
  "adjective",
  "verb",
  "adverb",
  "phrase",
  "proper_noun",
  "term",
]);

/** Cheap local gate: dictionary work must never run for sentences or unfinished prose. */
export function isLexiconCandidate(raw: string): boolean {
  const text = raw.trim();
  if (!text || text.length > 72 || /[\n\r.!?؟؛;:]/u.test(text)) return false;
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length > 4) return false;
  return words.some((word) => /[\p{L}\p{N}]/u.test(word));
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Defensive parser: malformed enrichment is discarded, never allowed to affect translation. */
export function parseLexicon(value: unknown): LexiconResult | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const sourceTerm = cleanString(data["sourceTerm"], 80);
  const sourceLanguage = cleanString(data["sourceLanguage"], 10);
  const targetLanguage = cleanString(data["targetLanguage"], 10);
  if (!sourceTerm || !sourceLanguage || !targetLanguage || !Array.isArray(data["entries"]))
    return null;

  const entries = data["entries"]
    .slice(0, 10)
    .map((raw): LexicalEntry | null => {
      if (!raw || typeof raw !== "object") return null;
      const entry = raw as Record<string, unknown>;
      const term = cleanString(entry["term"], 100);
      const kind = cleanString(entry["partOfSpeech"], 20) as LexicalKind;
      const meanings = Array.isArray(entry["meanings"])
        ? entry["meanings"]
            .map((item) => cleanString(item, 100))
            .filter(Boolean)
            .slice(0, 6)
        : [];
      if (!term || !KINDS.has(kind) || meanings.length === 0) return null;
      const freq = Number(entry["frequency"]);
      return {
        term,
        partOfSpeech: kind,
        meanings,
        definition: cleanString(entry["definition"], 240),
        example: cleanString(entry["example"], 240),
        exampleTranslation: cleanString(entry["exampleTranslation"], 240),
        primary: entry["primary"] === true,
        forms: cleanList(entry["forms"], 8),
        synonyms: cleanList(entry["synonyms"], 8),
        frequency: Number.isFinite(freq) ? Math.min(1, Math.max(0, freq)) : 0.5,
        register: cleanString(entry["register"], 40),
      };
    })
    .filter((entry): entry is LexicalEntry => entry !== null);

  if (entries.length === 0) return null;
  const translation = cleanString(data["translation"], 200);
  return { sourceTerm, sourceLanguage, targetLanguage, translation, entries: rankEntries(entries, translation) };
}

function cleanList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((item) => cleanString(item, 60))
    .filter((item) => item && !seen.has(item.toLocaleLowerCase()) && !!seen.add(item.toLocaleLowerCase()))
    .slice(0, max);
}

/**
 * Most common reading first: the one matching the model's translation wins,
 * then the model's "primary" flag, then everyday frequency.
 */
export function rankEntries(entries: LexicalEntry[], translation = ""): LexicalEntry[] {
  const t = translation.trim().toLocaleLowerCase();
  const matches = (e: LexicalEntry) =>
    !!t && [e.term, ...e.meanings, ...e.forms].some((w) => w.toLocaleLowerCase() === t);
  return [...entries].sort(
    (a, b) =>
      Number(matches(b)) - Number(matches(a)) ||
      Number(b.primary) - Number(a.primary) ||
      b.frequency - a.frequency,
  );
}

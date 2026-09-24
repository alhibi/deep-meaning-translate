export type LexicalKind = "noun" | "adjective" | "verb" | "adverb" | "phrase" | "proper_noun" | "term";

export interface LexicalEntry {
  term: string;
  partOfSpeech: LexicalKind;
  meanings: string[];
  definition: string;
  example: string;
  exampleTranslation: string;
  primary: boolean;
}

export interface LexiconResult {
  sourceTerm: string;
  sourceLanguage: string;
  targetLanguage: string;
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
  if (!sourceTerm || !sourceLanguage || !targetLanguage || !Array.isArray(data["entries"])) return null;

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
      return {
        term,
        partOfSpeech: kind,
        meanings,
        definition: cleanString(entry["definition"], 240),
        example: cleanString(entry["example"], 240),
        exampleTranslation: cleanString(entry["exampleTranslation"], 240),
        primary: entry["primary"] === true,
      };
    })
    .filter((entry): entry is LexicalEntry => entry !== null);

  if (entries.length === 0) return null;
  entries.sort((a, b) => Number(b.primary) - Number(a.primary));
  return { sourceTerm, sourceLanguage, targetLanguage, entries };
}

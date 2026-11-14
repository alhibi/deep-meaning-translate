import type { TranslationResult } from "./types";

const SITUATIONS = ["chat", "work", "official", "general"] as const;
const TAG_KEYS = ["kind", "domain", "intent"] as const;
const isText = (v: unknown): v is string => typeof v === "string";

/**
 * The complete result shape, shared by session restore, translation memory and the
 * repair server function. The previous storage check accepted four fields, so a row
 * missing tone/confidence/isAmbiguous/notes could reach the result panel or a repair.
 * Limits mirror the server's ResultSchema.
 */
export function isResult(v: unknown): v is TranslationResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (!isText(r["sourceLanguage"]) || r["sourceLanguage"].length > 10) return false;
  if (!isText(r["targetLanguage"]) || r["targetLanguage"].length > 10) return false;
  if (!isText(r["translation"]) || !r["translation"] || r["translation"].length > 15_000)
    return false;
  if (!isText(r["tone"]) || r["tone"].length > 60) return false;
  if (!isText(r["formality"]) || r["formality"].length > 30) return false;
  if (typeof r["confidence"] !== "number" || !Number.isFinite(r["confidence"])) return false;
  if (typeof r["isAmbiguous"] !== "boolean") return false;
  const alternatives = r["alternativeTranslations"];
  if (!Array.isArray(alternatives) || alternatives.length > 2) return false;
  if (!alternatives.every((a) => isText(a) && a.length <= 15_000)) return false;
  if (!isText(r["notes"]) || r["notes"].length > 300) return false;
  const situation = r["situation"];
  if (situation !== undefined && !SITUATIONS.includes(situation as (typeof SITUATIONS)[number]))
    return false;
  const tags = r["tags"];
  if (tags !== undefined) {
    if (!tags || typeof tags !== "object") return false;
    const t = tags as Record<string, unknown>;
    for (const key of TAG_KEYS) {
      const value = t[key];
      if (value !== undefined && !isText(value)) return false;
    }
  }
  return true;
}

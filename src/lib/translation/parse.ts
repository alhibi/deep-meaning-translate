import type { Situation, TranslationRequest, TranslationResult } from "./types";
import { TranslationError } from "./types";

const SITUATIONS: Situation[] = ["chat", "work", "official", "general"];

/** Parses the model's structured JSON reply. Shared by server and browser. */
export function parseResult(raw: string, req: TranslationRequest): TranslationResult {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new TranslationError("provider", "Malformed model output.");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new TranslationError("provider", "Malformed model output.");
  }
  const translation = typeof data["translation"] === "string" ? data["translation"] : "";
  if (!translation.trim()) throw new TranslationError("provider", "Empty translation.");
  const alts = Array.isArray(data["alternativeTranslations"])
    ? (data["alternativeTranslations"] as unknown[])
        .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
        .slice(0, 2)
    : [];
  return {
    sourceLanguage:
      typeof data["sourceLanguage"] === "string" ? data["sourceLanguage"] : req.source,
    targetLanguage:
      typeof data["targetLanguage"] === "string" ? data["targetLanguage"] : req.target,
    translation,
    tone: typeof data["tone"] === "string" ? data["tone"] : "",
    formality: typeof data["formality"] === "string" ? data["formality"] : "",
    confidence: typeof data["confidence"] === "number" ? data["confidence"] : 0.8,
    isAmbiguous: data["isAmbiguous"] === true,
    alternativeTranslations: alts,
    notes: typeof data["notes"] === "string" ? data["notes"].slice(0, 240) : "",
    situation: SITUATIONS.includes(data["situation"] as Situation)
      ? (data["situation"] as Situation)
      : "general",
  };
}

const ESC: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "",
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "",
  f: "",
};

/**
 * Reads the "translation" string out of a JSON reply that is still arriving,
 * so the text can be shown word by word before the JSON is complete.
 */
export function partialTranslation(raw: string): string {
  const m = /"translation"\s*:\s*"/.exec(raw);
  if (!m) return "";
  let out = "";
  for (let i = m.index + m[0].length; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === '"') break;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break; // escape not complete yet
    if (next === "u") {
      const hex = raw.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      out += ESC[next] ?? next;
      i += 1;
    }
  }
  return out;
}

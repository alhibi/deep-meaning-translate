import type { TranslationResult } from "./types";

const lang2 = (code: string | undefined) => (code ?? "").slice(0, 2).toLowerCase();

/**
 * A model sometimes returns the input unchanged for a short word or a name, especially
 * when the automatic source language equals the chosen target (typing German while the
 * chip says “Deutsch”). An echo is not a translation and must never become a stuck
 * skeleton: the screen should try the Arabic/German partner once instead.
 *
 * Comparison ignores surrounding whitespace, trailing sentence punctuation and case, so
 * “Hallo” and “Hallo.” count as the same text; it does not normalise letters, so a real
 * transliteration does not count as an echo.
 */
export function normalizeEcho(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?؟,،;؛:]+$/u, "")
    .toLowerCase();
}

export const isEcho = (text: string, result: TranslationResult | null): boolean =>
  !!result && normalizeEcho(result.translation) === normalizeEcho(text);

/** The other half of the product pair, or null for a target outside Arabic/German. */
export function languagePartner(target: string): "ar" | "de" | null {
  if (lang2(target) === "de") return "ar";
  if (lang2(target) === "ar") return "de";
  return null;
}

/**
 * Whether a result must be held back while the screen re-routes.
 *
 * Regression: a **provisional** live result carries sourceLanguage "auto", but its text
 * can equal the input. The old inline check (`translation.trim() === text.trim()`)
 * then held the result forever because nothing was going to flip the target, leaving a
 * skeleton on screen — the "translation does not work" failure for short German words
 * with the default Deutsch target. Only a settled result that explicitly detected the
 * target language may hold back the screen.
 */
export function shouldHoldForReroute(args: {
  source: string;
  target: string;
  result: TranslationResult | null;
  provisional: boolean;
}): boolean {
  const { source, target, result, provisional } = args;
  if (source !== "auto" || !result || provisional) return false;
  const detected = result.sourceLanguage;
  if (!detected || detected === "auto") return false;
  return lang2(detected) === lang2(target);
}

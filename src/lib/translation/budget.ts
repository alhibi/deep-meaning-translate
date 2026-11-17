/**
 * Output budget for one translation.
 *
 * `max_tokens` is not a target — it is a ceiling that stops a provider from running away
 * on a bad day. It exists to bound a pathological generation, never to shrink a legitimate
 * translation: truncation is a hard failure (the structured reply becomes invalid JSON, a
 * live reply silently loses its ending), so the ceiling must sit far above the largest
 * real answer.
 *
 * The provider contract (DeepSeek API reference, accessed 2026-11-17) allows `max_tokens`
 * up to 393,216 on `deepseek-flash`; the default is 8K in non-thinking mode. A
 * 5,000-character source needs roughly 2.6 output tokens per source character for a full
 * JSON result, so the ceilings below are conservative by two orders of magnitude relative
 * to what the model accepts.
 *
 * - structured (full JSON result): floor 512, factor 2.6, ceiling 16,384.
 * - live (plain provisional text): floor 256, factor 1.5, ceiling 8,192 — it is superseded
 *   quickly, so a tighter ceiling is enough, but it must still cover a long paste.
 *
 * Task classes that reason before answering (repair/review/analysis) cannot use these
 * plain-answer ceilings directly: reasoning tokens share the generation, so
 * `providers/capabilities.ts` raises their ceilings above these values. Nothing here is
 * ever lowered by a profile.
 */
export function outputTokenBudget(chars: number, structured: boolean): number {
  const min = structured ? 512 : 256;
  const max = structured ? 16_384 : 8_192;
  const factor = structured ? 2.6 : 1.5;
  return Math.min(max, Math.max(min, Math.ceil(Math.max(0, chars) * factor)));
}

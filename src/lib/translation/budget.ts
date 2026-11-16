/**
 * Output budget for one translation.
 *
 * `max_tokens` is not a target — it is a ceiling that stops a provider from running away
 * on a bad day. It exists to bound a pathological generation, never to shrink a legitimate
 * translation: truncation is a hard failure (the structured reply becomes invalid JSON, a
 * live reply silently loses its ending), so the ceiling must sit far above the largest
 * real answer. DeepSeek accepts 16384 for `deepseek-flash`, and a 5,000-character source
 * needs roughly 2.6 output tokens per source character for a full JSON result.
 *
 * - structured (full JSON result): floor 512, factor 2.6, ceiling 16,384.
 * - live (plain provisional text): floor 256, factor 1.5, ceiling 8,192 — it is superseded
 *   quickly, so a tighter ceiling is enough, but it must still cover a long paste.
 */
export function outputTokenBudget(chars: number, structured: boolean): number {
  const min = structured ? 512 : 256;
  const max = structured ? 16_384 : 8_192;
  const factor = structured ? 2.6 : 1.5;
  return Math.min(max, Math.max(min, Math.ceil(Math.max(0, chars) * factor)));
}

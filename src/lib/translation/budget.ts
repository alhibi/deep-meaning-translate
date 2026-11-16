/**
 * Output budget for one translation.
 *
 * `max_tokens` is not a target — it is a ceiling that stops a provider from running away
 * on a bad day. Live requests get a tighter ceiling because they are provisional and get
 * superseded; structured results need room for the JSON fields but not an unbounded one.
 * The floor keeps short sentences whole; the cap keeps a 5,000-character paste finite.
 */
export function outputTokenBudget(chars: number, structured: boolean): number {
  const min = structured ? 384 : 160;
  const max = structured ? 4096 : 2048;
  const factor = structured ? 2.2 : 1.35;
  return Math.min(max, Math.max(min, Math.ceil(Math.max(0, chars) * factor)));
}

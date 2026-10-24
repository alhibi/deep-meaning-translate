import { isDimensionValue, type Dimension } from "./taxonomy";
import { RANGES, isDayKey, type Filters, type RangeId } from "./engine";

export interface StatsSearch extends Filters {
  range?: RangeId | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/**
 * The statistics page keeps its period and filters in the URL, so a shared link or a
 * Back press restores the exact view. Everything arriving here is untrusted text
 * typed by a stranger: only well-formed values survive, everything else is dropped
 * silently (the page then shows its default period, never an error).
 */
export function parseSearch(input: Record<string, unknown>): StatsSearch {
  const out: StatsSearch = {};
  const { range, from, to, pair, lang } = input;
  if (RANGES.includes(range as RangeId)) out.range = range as RangeId;
  if (isDayKey(from)) out.from = from;
  if (isDayKey(to)) out.to = to;
  // A pair is `xx>yy` or `auto>yy`; anything else cannot be produced by the app.
  if (typeof pair === "string" && /^([a-z]{2}|auto)>[a-z]{2}$/.test(pair)) out.pair = pair;
  if (typeof lang === "string" && /^([a-z]{2}|auto)$/.test(lang)) out.lang = lang;
  for (const dimension of ["kind", "domain", "intent", "register"] as Dimension[])
    if (isDimensionValue(dimension, input[dimension])) out[dimension] = input[dimension] as string;
  return out;
}

/** Only the keys the page actually filters by, in a stable order (used for labels). */
export function activeFilterKeys(search: StatsSearch): string[] {
  return (["pair", "lang", "kind", "domain", "intent", "register"] as const).filter(
    (key) => search[key],
  );
}

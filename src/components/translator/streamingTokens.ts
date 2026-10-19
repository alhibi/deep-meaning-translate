/** Words and the whitespace between them, in order; joining gives back the exact text. */
export function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/** How many leading tokens are unchanged, so they can stay still on screen. */
export function stableTokens(prev: string[], next: string[]): number {
  let i = 0;
  while (i < prev.length && i < next.length && prev[i] === next[i]) i++;
  // The last shown word may still be growing ("Hal" → "Hallo"): it re-animates, the rest stay.
  return i;
}

/** Index of the word token that contains (or follows) a character offset in the joined text. */
export function tokenAt(tokens: string[], charIndex: number): number {
  let pos = 0;
  for (let i = 0; i < tokens.length; i++) {
    const end = pos + tokens[i]!.length;
    if (charIndex < end) return /^\s+$/.test(tokens[i]!) ? Math.min(i + 1, tokens.length - 1) : i;
    pos = end;
  }
  return tokens.length - 1;
}

/**
 * Fallback when the voice sends no word events: estimated character position
 * after `ms` of speech. Arabic is spoken slower per character than Latin script.
 */
export function estimateChar(ms: number, rate: number, rtl: boolean): number {
  const perSec = (rtl ? 11 : 14.5) * rate;
  return Math.floor((ms / 1000) * perSec);
}

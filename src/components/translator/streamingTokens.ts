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

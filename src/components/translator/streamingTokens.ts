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

/** Whitespace belongs to the preceding spoken word, never highlights the next word early. */
export function tokenAt(tokens: string[], charIndex: number): number {
  let pos = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    const end = pos + token.length;
    if (charIndex < end && !/^\s+$/.test(token)) return i;
    if (charIndex < end && i > 0) return i - 1;
    pos = end;
  }
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/\S/.test(tokens[i] ?? "")) return i;
  }
  return -1;
}

/**
 * Fallback when the voice sends no word events: estimated character position
 * after `ms` of speech. Arabic is spoken slower per character than Latin script.
 */
export function estimateChar(ms: number, rate: number, rtl: boolean): number {
  const perSec = (rtl ? 11 : 14.5) * rate;
  return Math.floor((ms / 1000) * perSec);
}

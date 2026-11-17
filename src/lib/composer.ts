import { MAX_TEXT } from "./persistence/contracts";

export { MAX_TEXT as MAX_DRAFT_LENGTH } from "./persistence/contracts";

/** Keep exact whitespace and never cut a UTF-16 surrogate pair at the server's limit. */
export function limitDraft(value: string): string {
  if (value.length <= MAX_TEXT) return value;
  const last = value.charCodeAt(MAX_TEXT - 1);
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? MAX_TEXT - 1 : MAX_TEXT);
}

/** Digits, punctuation, emoji and combining marks cannot choose a reading direction. */
export function draftDirection(value: string, fallback: "rtl" | "ltr" = "ltr"): "rtl" | "ltr" {
  const letter = value.match(/\p{L}/u)?.[0];
  if (!letter) return fallback;
  return /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1eeff}]/u.test(
    letter,
  )
    ? "rtl"
    : "ltr";
}

/** Append recognition to a fixed draft; dictation must never flatten its paragraphs. */
export function appendDictation(base: string, spoken: string): string {
  const phrase = spoken.trim();
  if (!phrase) return base;
  return `${base}${base && !/\s$/.test(base) ? " " : ""}${phrase}`;
}

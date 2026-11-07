import type { TranslationRequest, TranslationResult } from "./types";

const URL_RE = /https?:\/\/[^\s)]+/g;
/** Digits in either script: an Arabic translation may write ٣٥ where German wrote 35. */
const NUM_RE = /[0-9\u0660-\u0669\u06F0-\u06F9]+(?:[.,][0-9\u0660-\u0669\u06F0-\u06F9]+)*/g;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/**
 * Numbers that may legitimately change shape between Arabic and German:
 * Western digits (0-9) and Arabic-Indic digits (٠-٩ / ۰-۹) are both used in Arabic
 * text, and either may appear in the translation of the other.
 */
const DIGIT_MAP: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

/**
 * Arabic punctuation a faithful translation keeps (، ؛ ؟).
 * Deliberately not global: a global regex carries `lastIndex` between `.test()` calls
 * and would make the same input pass and fail on alternating requests.
 */
const ARABIC_PUNCT = /[،؛؟]/u;

/**
 * Canonical form of one number, so that formatting may change and value may not.
 *
 * Separators are structural here, not decorative: a single separator followed by
 * exactly three digits groups thousands ("1.000" in German, "1,000" in English),
 * while any other final group is a decimal part. With several separators the last
 * short group is the decimal part and everything before it groups thousands. Both
 * numeral systems fold to ASCII, so ٣٥ and 35 stay equal — but 1,5 and 15 do not,
 * which the previous digits-only comparison could not tell apart.
 */
function canonicalNumber(value: string): string {
  const digits = value.replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] ?? d);
  const parts = digits.split(/[.,]/);
  if (parts.length === 1) return digits;
  const last = parts.pop()!;
  const int = parts.join("");
  const out = last.length === 3 ? int + last : `${int}.${last}`;
  // 1,50 and 1.5 are the same number; trailing decimal zeros are formatting.
  return out.includes(".") ? out.replace(/\.?0+$/, "") : out;
}

function multiset(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of list) m.set(item, (m.get(item) ?? 0) + 1);
  return m;
}

function missing(src: string[], out: string[]): string[] {
  const outSet = multiset(out);
  const gone: string[] = [];
  for (const [value, count] of multiset(src)) {
    const have = outSet.get(value) ?? 0;
    if (have < count) gone.push(value);
  }
  return gone;
}

/**
 * Capitalised words are the cheapest reliable signal for a name in German, and a
 * dropped name is one of the worst silent failures a translator can make. German
 * capitalises every noun, so only multi-syllable words that look like names count,
 * and words the app itself knows (language names, weekdays, months) are excluded.
 */
const NAME_STOPWORDS = new Set([
  "Ich",
  "Du",
  "Er",
  "Sie",
  "Es",
  "Wir",
  "Ihr",
  "Der",
  "Die",
  "Das",
  "Ein",
  "Eine",
  "Heute",
  "Morgen",
  "Gestern",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
  "Januar",
  "Februar",
  "März",
  "April",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
  "Deutsch",
  "Deutschland",
  "Arabisch",
  "Bitte",
  "Danke",
  "Hallo",
  "Guten",
  "Sehr",
  "Aber",
]);

export function nameCandidates(text: string): string[] {
  const words = text.match(/\b[\p{Lu}][\p{L}'’-]{2,}\b/gu) ?? [];
  return [...new Set(words)].filter((w) => !NAME_STOPWORDS.has(w));
}

/**
 * Lightweight, deterministic checks. Never surfaced to the user; a failure triggers
 * one quiet repair pass, and only a repair that clears more issues than it creates
 * is ever shown.
 */
export function verifyTranslation(req: TranslationRequest, res: TranslationResult): string[] {
  const issues: string[] = [];
  const src = req.text;
  const out = res.translation ?? "";

  if (!out.trim()) {
    issues.push("The translation is empty.");
    return issues;
  }

  const lostUrls = missing(src.match(URL_RE) ?? [], out.match(URL_RE) ?? []);
  if (lostUrls.length) issues.push(`URLs dropped or altered: ${lostUrls.join(", ")}`);

  const lostNums = missing(
    (src.match(NUM_RE) ?? []).map(canonicalNumber),
    (out.match(NUM_RE) ?? []).map(canonicalNumber),
  );
  if (lostNums.length) issues.push(`Numbers missing from the translation: ${lostNums.join(", ")}`);

  const lostEmoji = missing(src.match(EMOJI_RE) ?? [], out.match(EMOJI_RE) ?? []);
  if (lostEmoji.length) issues.push(`Emojis dropped: ${lostEmoji.join(" ")}`);

  // Names: kept verbatim in either script. A name may be transliterated into Arabic,
  // so only a name with no trace at all is reported — never a spelling difference.
  const names = nameCandidates(src);
  const lowerOut = out.toLocaleLowerCase();
  const lostNames = names.filter((name) => !lowerOut.includes(name.toLocaleLowerCase()));
  if (lostNames.length && req.source !== "ar" && req.target !== "ar")
    issues.push(`Names may have been dropped or changed: ${lostNames.join(", ")}`);

  const srcLines = src.trim().split(/\n{2,}/).length;
  const outLines = out.trim().split(/\n{2,}/).length;
  if (srcLines > 1 && outLines < srcLines) issues.push("Paragraph structure was not preserved.");

  const ratio = out.length / Math.max(src.length, 1);
  if (src.length > 40 && ratio > 2.6)
    issues.push("The translation is far longer than the source; it may add invented content.");
  if (src.length > 40 && ratio < 0.35)
    issues.push("The translation is far shorter than the source; content may be missing.");

  if (/^(translation|übersetzung|ترجمة)\s*[:：]/i.test(out.trim()))
    issues.push("The translation contains a label prefix instead of plain text.");

  // The model is told never to explain; a trailing "Note:" block is a silent change of
  // register that also breaks read-along highlighting.
  if (/(^|\n)\s*(note|hinweis|ملاحظة)\s*[:：]/i.test(out))
    issues.push("The translation contains an explanation that the source did not have.");

  // Question and exclamation marks carry intent; losing them changes the sentence type.
  const srcAsks = (src.match(/[?？؟]/g) ?? []).length;
  const outAsks = (out.match(/[?？؟]/g) ?? []).length;
  if (srcAsks > 0 && outAsks === 0 && src.length < 300)
    issues.push("The question mark was dropped; the sentence type changed.");

  // Arabic punctuation should survive into Arabic output, and must not leak into German,
  // where it is simply wrong.
  if (req.target === "ar" && ARABIC_PUNCT.test(src) && !ARABIC_PUNCT.test(out))
    issues.push("Arabic punctuation (، ؛ ؟) was replaced or dropped.");
  if (req.target !== "ar" && ARABIC_PUNCT.test(out))
    issues.push("Arabic punctuation appeared in non-Arabic text.");

  return issues;
}

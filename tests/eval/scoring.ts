import { verifyTranslation } from "../../src/lib/translation/verify";
import type { TranslationRequest, TranslationResult } from "../../src/lib/translation/types";
import type { EvalCase, EvalInvariants, TermInvariant } from "./corpus/types";

/**
 * Deterministic scoring for the evaluation corpus.
 *
 * Every check here is a narrow, conservative machine check: it can prove a fact was lost,
 * never that a sentence means the same thing. Meaning, intent, register and naturalness
 * remain human-review evidence (NOT_VERIFIED in this environment). The independent judge
 * is a secondary signal and is never mixed into these booleans.
 */

export interface FactSet {
  /** d-m-y, leading zeros dropped: 2026-03-12 and 12.03.2026 both become "12-3-2026". */
  dates: string[];
  /** h:mm. */
  times: string[];
  /** Numeric values with thousands/decimal separators folded. */
  numbers: number[];
}

const ARABIC_DIGITS: Record<string, string> = {
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

export function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d] ?? d);
}

const DATE_RE = /(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/g;
const TIME_RE = /\b(\d{1,2}):(\d{2})\b/g;
const NUMBER_RE = /-?\d+(?:[.,]\d+)*/g;

/** "2026-03-12" → "12-3-2026"; "12.03.2026" → "12-3-2026"; "3/10/2026" → "3-10-2026". */
function canonicalDate(a: string, b: string, c: string): string {
  const first = Number(a);
  if (a.length === 4) return `${Number(c)}-${Number(b)}-${first}`;
  return `${first}-${Number(b)}-${Number(c)}`;
}

/** 1.250,50 → 1250.5; 1,250.50 → 1250.5; 47.5 → 47.5; 1.250 → 1250; 2,5 → 2.5. */
export function parseNumberValue(token: string): number {
  const normalized = normalizeDigits(token);
  const negative = normalized.startsWith("-");
  const digits = normalized.replace(/[^\d.,]/g, "");
  if (!digits) return Number.NaN;
  const hasDot = digits.includes(".");
  const hasComma = digits.includes(",");
  let value: number;
  if (hasDot && hasComma) {
    const decimal = digits.lastIndexOf(".") > digits.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    value = Number(digits.split(thousands).join("").replace(decimal, "."));
  } else {
    const separator = hasDot ? "." : hasComma ? "," : null;
    if (!separator) {
      value = Number(digits);
    } else {
      const parts = digits.split(separator);
      const last = parts[parts.length - 1] ?? "";
      // One separator with exactly three trailing digits groups thousands (1.250).
      // Anything else is a decimal part (47.5, 2,5). This mirrors verify.ts.
      if (parts.length === 2 && last.length === 3) value = Number(parts.join(""));
      else if (parts.length > 2) value = Number(parts.join(""));
      else value = Number(`${parts[0]}.${last}`);
    }
  }
  return negative && value > 0 ? -value : value;
}

export function extractFacts(text: string): FactSet {
  const normalized = normalizeDigits(text);
  const dates: string[] = [];
  const times: string[] = [];
  const numbers: number[] = [];
  let rest = normalized.replace(DATE_RE, (_m, a: string, b: string, c: string) => {
    dates.push(canonicalDate(a, b, c));
    return " ";
  });
  rest = rest.replace(TIME_RE, (_m, h: string, m: string) => {
    times.push(`${Number(h)}:${m}`);
    return " ";
  });
  for (const match of rest.match(NUMBER_RE) ?? []) {
    const value = parseNumberValue(match);
    if (Number.isFinite(value)) numbers.push(value);
  }
  return { dates, times, numbers };
}

export function expectedFacts(caseInvariants: EvalInvariants): FactSet {
  const facts: FactSet = { dates: [], times: [], numbers: [] };
  for (const value of caseInvariants.numbers ?? []) {
    if (/^\d{1,4}-\d{1,2}-\d{1,4}$/.test(value)) {
      const [a, b, c] = value.split("-") as [string, string, string];
      facts.dates.push(canonicalDate(a, b, c));
    } else if (/^\d{1,2}:\d{2}$/.test(value)) {
      const [h, m] = value.split(":") as [string, string];
      facts.times.push(`${Number(h)}:${m}`);
    } else {
      facts.numbers.push(parseNumberValue(value));
    }
  }
  return facts;
}

function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-6);
}

/** Every expected value appears at least as often as expected. */
export function factsPreserved(
  expected: FactSet,
  actual: FactSet,
): { ok: boolean; missing: string[]; extraNumbers: number[] } {
  const missing: string[] = [];
  const count = (list: string[], value: string) => list.filter((item) => item === value).length;
  const seenDates = new Map<string, number>();
  for (const date of expected.dates) seenDates.set(date, (seenDates.get(date) ?? 0) + 1);
  for (const [date, wanted] of seenDates) {
    if (count(actual.dates, date) < wanted) missing.push(date);
  }
  const seenTimes = new Map<string, number>();
  for (const time of expected.times) seenTimes.set(time, (seenTimes.get(time) ?? 0) + 1);
  for (const [time, wanted] of seenTimes) {
    if (count(actual.times, time) < wanted) missing.push(time);
  }
  const seenNumbers = new Map<number, number>();
  for (const value of expected.numbers) seenNumbers.set(value, (seenNumbers.get(value) ?? 0) + 1);
  for (const [value, wanted] of seenNumbers) {
    if (actual.numbers.filter((n) => sameValue(n, value)).length < wanted)
      missing.push(String(value));
  }
  const extraNumbers = actual.numbers.filter(
    (n) => !expected.numbers.some((value) => sameValue(n, value)),
  );
  return { ok: missing.length === 0, missing, extraNumbers };
}

/** Arabic matching ignores harakat/tatweel and alef/ya/ta-marbuta spelling variants. */
export function normalizeArabic(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

function arabicTokens(text: string): string[] {
  return normalizeArabic(text)
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

function germanTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

function termAppears(term: string, output: string, target: "ar" | "de"): boolean {
  if (target === "ar") return normalizeArabic(output).includes(normalizeArabic(term).toLowerCase());
  return output.toLowerCase().includes(term.toLowerCase());
}

function forbiddenAppears(term: string, output: string, target: "ar" | "de"): boolean {
  if (term.trim().includes(" ")) return termAppears(term, output, target);
  const tokens = target === "ar" ? arabicTokens(output) : germanTokens(output);
  const wanted = target === "ar" ? normalizeArabic(term).toLowerCase() : term.toLowerCase();
  return tokens.includes(wanted);
}

function anyTermSatisfied(
  terms: TermInvariant[] | undefined,
  output: string,
  target: "ar" | "de",
  forbidden: boolean,
): string[] {
  const failures: string[] = [];
  for (const term of terms ?? []) {
    const hit = term.any.some((alternative) =>
      forbidden
        ? forbiddenAppears(alternative, output, target)
        : termAppears(alternative, output, target),
    );
    if (forbidden ? hit : !hit) failures.push(term.id);
  }
  return failures;
}

const GERMAN_NEGATION =
  /\b(?:nicht|nichts|kein(?:e|en|em|er|es)?|nie|niemals|niemand(?:em|en)?|ohne|nirgends|nirgendwo|weder)\b/i;
const ARABIC_NEGATION = new Set([
  "لا",
  "لم",
  "لن",
  "ليس",
  "ليست",
  "غير",
  "مش",
  "ما",
  "أبدا",
  "أبداً",
  "ولا",
  "ولم",
  "ولن",
  "ليسوا",
  "بلا",
  "بدون",
]);

export function hasNegation(output: string, target: "ar" | "de"): boolean {
  if (target === "de") return GERMAN_NEGATION.test(output);
  return arabicTokens(output).some((token) => ARABIC_NEGATION.has(token));
}

export function paragraphCount(text: string): number {
  return text
    .trim()
    .split(/\n\s*\n/)
    .filter((block) => block.trim().length > 0).length;
}

export function sentenceCount(text: string): number {
  return (text.match(/[.!?؟…]+/g) ?? []).length;
}

export interface CaseChecks {
  facts: boolean;
  terms: boolean;
  forbidden: boolean;
  negation: boolean;
  questionMark: boolean;
  paragraphs: boolean;
  urls: boolean;
  emojis: boolean;
  verify: boolean;
}

export interface CaseScore {
  id: string;
  direction: EvalCase["direction"];
  category: EvalCase["category"];
  pass: boolean;
  checks: CaseChecks;
  verifyIssues: string[];
  details: string[];
  soft: {
    registerMarker: boolean | null;
    dialectMarker: boolean | null;
    ambiguous: boolean | null;
    lengthRatio: number;
    sourceSentences: number;
    outputSentences: number;
    extraNumbers: number[];
  };
}

export function scoreCase(
  testCase: EvalCase,
  req: TranslationRequest,
  result: TranslationResult,
): CaseScore {
  const target: "ar" | "de" = testCase.direction === "de→ar" ? "ar" : "de";
  const output = result.translation ?? "";
  const inv = testCase.invariants;
  const details: string[] = [];
  const facts = factsPreserved(expectedFacts(inv), extractFacts(output));
  if (!facts.ok) details.push(`facts lost: ${facts.missing.join(", ")}`);
  const termFailures = anyTermSatisfied(inv.requiredTerms, output, target, false);
  if (termFailures.length) details.push(`terminology missing: ${termFailures.join(", ")}`);
  const forbiddenFailures = anyTermSatisfied(inv.forbiddenTerms, output, target, true);
  if (forbiddenFailures.length)
    details.push(`forbidden wording present: ${forbiddenFailures.join(", ")}`);
  const negationOk = inv.negation === "keep" ? hasNegation(output, target) : true;
  if (!negationOk) details.push("negation missing");
  const questionOk = inv.questionMark === true ? /[?？؟]/.test(output) : true;
  if (!questionOk) details.push("question mark missing");
  const paragraphsOk =
    inv.paragraphs === undefined ? true : paragraphCount(output) === inv.paragraphs;
  if (!paragraphsOk)
    details.push(`paragraph count ${paragraphCount(output)} !== ${inv.paragraphs}`);
  const urlsOk = (inv.urls ?? []).every((url) => output.includes(url));
  if (!urlsOk) details.push("URL missing or altered");
  const emojisOk = (inv.emojis ?? []).every((emoji) => output.includes(emoji));
  if (!emojisOk) details.push("emoji missing");
  const verifyIssues = verifyTranslation(req, result);
  if (verifyIssues.length) details.push(...verifyIssues.map((issue) => `verify: ${issue}`));
  const checks: CaseChecks = {
    facts: facts.ok,
    terms: termFailures.length === 0,
    forbidden: forbiddenFailures.length === 0,
    negation: negationOk,
    questionMark: questionOk,
    paragraphs: paragraphsOk,
    urls: urlsOk,
    emojis: emojisOk,
    verify: verifyIssues.length === 0,
  };
  const pass = Object.values(checks).every(Boolean);
  const registerMarker = inv.registerMarkers
    ? anyTermSatisfied([inv.registerMarkers], output, target, false).length === 0
    : null;
  const dialectMarker = inv.dialectMarkers
    ? anyTermSatisfied([inv.dialectMarkers], output, target, false).length === 0
    : null;
  const ambiguous = inv.expectAmbiguous === true ? result.isAmbiguous === true : null;
  return {
    id: testCase.id,
    direction: testCase.direction,
    category: testCase.category,
    pass,
    checks,
    verifyIssues,
    details,
    soft: {
      registerMarker,
      dialectMarker,
      ambiguous,
      lengthRatio: output.length / Math.max(1, testCase.source.length),
      sourceSentences: sentenceCount(testCase.source),
      outputSentences: sentenceCount(output),
      extraNumbers: facts.extraNumbers,
    },
  };
}

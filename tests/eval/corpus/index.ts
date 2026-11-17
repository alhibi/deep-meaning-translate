import { CORPUS_V1 } from "./v1";
import type { CorpusVersion, EvalCase } from "./types";

/** Bump the number when the frozen corpus changes; the runner records it in every artefact. */
export const CURRENT_CORPUS: CorpusVersion = CORPUS_V1;

const DIRECTIONS = ["ar→de", "de→ar"] as const;

/** Structural validation; content quality (is the Arabic natural?) needs the human reviewer. */
export function validateCorpus(corpus: CorpusVersion): string[] {
  const problems: string[] = [];
  if (corpus.cases.length < 40)
    problems.push(`expected at least 40 cases, got ${corpus.cases.length}`);
  const ids = new Set<string>();
  for (const testCase of corpus.cases) {
    if (ids.has(testCase.id)) problems.push(`duplicate case id: ${testCase.id}`);
    ids.add(testCase.id);
    if (!testCase.source.trim()) problems.push(`${testCase.id}: empty source`);
    if (testCase.humanReview.status === "NOT_VERIFIED") {
      if (testCase.humanReview.reviewer !== null)
        problems.push(`${testCase.id}: unreviewed row names a reviewer`);
      if (testCase.humanReview.reviewedAt !== null)
        problems.push(`${testCase.id}: unreviewed row has a date`);
      if (!testCase.humanReview.focus.trim())
        problems.push(`${testCase.id}: unreviewed row has no review focus`);
    }
    const target = testCase.direction === "ar→de" ? "de" : "ar";
    if (target === "de" && testCase.dialect !== undefined)
      problems.push(`${testCase.id}: dialect only applies when Arabic is the target`);
    if (target === "ar" && testCase.dialect === undefined)
      problems.push(`${testCase.id}: Arabic-target row must name a dialect (auto/msa/levant)`);
    const inv = testCase.invariants;
    if (inv.negation !== undefined && inv.negation !== "keep")
      problems.push(`${testCase.id}: unknown negation mode`);
    if (inv.paragraphs !== undefined && inv.paragraphs < 1)
      problems.push(`${testCase.id}: paragraph count < 1`);
    for (const key of ["requiredTerms", "forbiddenTerms"] as const) {
      for (const term of inv[key] ?? []) {
        if (!term.id.trim() || term.any.length === 0)
          problems.push(`${testCase.id}: malformed ${key}`);
        if (term.any.some((a) => !a.trim()))
          problems.push(`${testCase.id}: empty alternative in ${key}`);
      }
    }
    // Numbers must be canonical forms the scorer understands (dates as d-m-y, times h:mm).
    for (const value of inv.numbers ?? []) {
      if (
        !/^\d{1,4}-\d{1,2}-\d{1,4}$/.test(value) &&
        !/^\d{1,2}:\d{2}$/.test(value) &&
        !/^-?\d+(?:\.\d+)?$/.test(value)
      )
        problems.push(`${testCase.id}: not a canonical fact: ${value}`);
    }
  }
  for (const direction of DIRECTIONS) {
    const count = corpus.cases.filter((c) => c.direction === direction).length;
    if (count < 20) problems.push(`expected at least 20 ${direction} cases, got ${count}`);
  }
  const categories = new Set(corpus.cases.map((c) => c.category));
  for (const required of [
    "everyday-chat",
    "workplace",
    "official",
    "levantine",
    "idioms-culture",
    "sarcasm-implied",
    "negation-ambiguity",
    "technical",
    "facts-numbers",
    "long-paragraph",
  ])
    if (!categories.has(required as EvalCase["category"]))
      problems.push(`corpus misses category: ${required}`);
  return problems;
}

/** One request per case: the production request shape with the case's style hints. */
export function requestFor(testCase: EvalCase) {
  const arTarget = testCase.direction === "de→ar";
  return {
    text: testCase.source,
    source: arTarget ? "de" : "ar",
    target: arTarget ? "ar" : "de",
    style: testCase.style,
    ...(arTarget ? { dialect: testCase.dialect ?? "auto" } : {}),
  } as const;
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_CORPUS, validateCorpus } from "../../../../tests/eval/corpus";
import type { EvalCase } from "../../../../tests/eval/corpus/types";
import {
  expectedFacts,
  extractFacts,
  factsPreserved,
  hasNegation,
  paragraphCount,
  parseNumberValue,
  scoreCase,
} from "../../../../tests/eval/scoring";
import type { TranslationRequest, TranslationResult } from "../types";

// Vitest's import.meta.url is not a file URL under the jsdom transform; the suite runs
// from the project root, so resolve the committed fixture from there.
const fixturePath = resolve(process.cwd(), "tests/eval/fixtures/baseline-v1.json");

const result = (translation: string): TranslationResult => ({
  sourceLanguage: "ar",
  targetLanguage: "de",
  translation,
  tone: "",
  formality: "",
  confidence: 0.8,
  isAmbiguous: false,
  alternativeTranslations: [],
  notes: "",
});

const inlineCase = (overrides: Partial<EvalCase> = {}): EvalCase => ({
  id: "inline",
  direction: "ar→de",
  category: "facts-numbers",
  context: "general",
  style: "natural",
  source: "الجواب هو 42.",
  invariants: { numbers: ["42"] },
  humanReview: { status: "NOT_VERIFIED", reviewer: null, reviewedAt: null, focus: "inline" },
  ...overrides,
});

const inlineRequest: TranslationRequest = {
  text: "الجواب هو 42.",
  source: "ar",
  target: "de",
  style: "natural",
};

/**
 * The frozen corpus is product evidence, so it is validated in the standing gate (no
 * network, no cost). Deterministic scoring itself is pinned here with hand-made pairs;
 * the live run under tests/eval/ uses exactly these functions.
 */
describe("arabic ⇄ german evaluation corpus v1", () => {
  it("is structurally valid and big enough to compare configurations", () => {
    expect(validateCorpus(CURRENT_CORPUS)).toEqual([]);
    expect(CURRENT_CORPUS.version).toBe("1.0.0");
    expect(CURRENT_CORPUS.cases.length).toBeGreaterThanOrEqual(40);
    const arToDe = CURRENT_CORPUS.cases.filter((item) => item.direction === "ar→de");
    const deToAr = CURRENT_CORPUS.cases.filter((item) => item.direction === "de→ar");
    expect(arToDe.length).toBeGreaterThanOrEqual(20);
    expect(deToAr.length).toBeGreaterThanOrEqual(20);
  });

  it("covers every promised risk category in both directions", () => {
    // Levantine appears as an Arabic SOURCE category; on the German→Arabic side the same
    // risk is the requested variety (`dialect`), so each direction is required to prove
    // the risk the only way it exists there.
    const required = [
      "everyday-chat",
      "workplace",
      "official",
      "formal",
      "casual",
      "idioms-culture",
      "sarcasm-implied",
      "negation-ambiguity",
      "technical",
      "facts-numbers",
      "long-paragraph",
    ];
    for (const direction of ["ar→de", "de→ar"] as const) {
      const cases = CURRENT_CORPUS.cases.filter((item) => item.direction === direction);
      const categories = new Set(cases.map((item) => item.category));
      for (const category of required) {
        expect(
          categories.has(category as EvalCase["category"]),
          `${direction} misses ${category}`,
        ).toBe(true);
      }
      if (direction === "ar→de") {
        expect(categories.has("levantine"), "ar→de misses levantine").toBe(true);
      } else {
        const dialects = new Set(cases.map((item) => item.dialect));
        expect(dialects.has("levant"), "de→ar misses a Levantine output row").toBe(true);
        expect(dialects.has("msa"), "de→ar misses an MSA output row").toBe(true);
      }
    }
  });

  it("keeps a review slot on every row and never claims a review it does not have", () => {
    for (const item of CURRENT_CORPUS.cases) {
      expect(["NOT_VERIFIED", "REVIEWED"]).toContain(item.humanReview.status);
      if (item.humanReview.status === "REVIEWED") {
        expect(item.humanReview.reviewer).toBeTruthy();
        expect(item.humanReview.reviewedAt).toBeTruthy();
      } else {
        expect(item.humanReview.reviewer).toBeNull();
        expect(item.humanReview.reviewedAt).toBeNull();
      }
      expect(item.humanReview.focus.length).toBeGreaterThan(0);
    }
  });

  it("records the documentation check behind the model capabilities", () => {
    expect(CURRENT_CORPUS.verifiedAgainst.model).toBe("deepseek-flash");
    expect(CURRENT_CORPUS.verifiedAgainst.docsAccessedAt).toBe("2026-11-17");
    expect(CURRENT_CORPUS.verifiedAgainst.urls.length).toBeGreaterThanOrEqual(4);
  });
});

describe("deterministic fact extraction", () => {
  it("canonicalises dates and decimal/thousands separators in both directions", () => {
    expect(
      extractFacts("وصلت الشحنة يوم 12/03/2026 ووزنها 47.5 كيلوغرام وتكلفتها 1,250 يورو").dates,
    ).toEqual(["12-3-2026"]);
    expect(
      extractFacts("Die Rechnung über 1.250,50 Euro wurde am 30.06.2026 bezahlt").dates,
    ).toEqual(["30-6-2026"]);
    expect(parseNumberValue("1.250")).toBe(1250);
    expect(parseNumberValue("2,5")).toBe(2.5);
    expect(parseNumberValue("1.250,50")).toBe(1250.5);
    expect(parseNumberValue("1,250.50")).toBe(1250.5);
    expect(parseNumberValue("١٢٥٠")).toBe(1250);
  });

  it("reports a dropped number and an invented number instead of hiding them", () => {
    const expected = expectedFacts({ numbers: ["42"] });
    const preserved = factsPreserved(expected, extractFacts("Die Antwort ist 42."));
    expect(preserved.ok).toBe(true);
    expect(preserved.extraNumbers).toEqual([]);
    const dropped = factsPreserved(expected, extractFacts("Die Antwort ist bekannt."));
    expect(dropped.ok).toBe(false);
    expect(dropped.missing).toEqual(["42"]);
    const added = factsPreserved(expected, extractFacts("Die Antwort ist 42 und 43."));
    expect(added.extraNumbers).toEqual([43]);
  });

  it("counts paragraphs and keeps negation markers conservative", () => {
    expect(paragraphCount("eins\n\nzwei\n\ndrei")).toBe(3);
    expect(paragraphCount("eins\nzwei")).toBe(1);
    expect(hasNegation("Ich komme heute nicht.", "de")).toBe(true);
    expect(hasNegation("Ich komme heute.", "de")).toBe(false);
    expect(hasNegation("أنا مش زعلان", "ar")).toBe(true);
    expect(hasNegation("أنا مبسوط", "ar")).toBe(false);
  });
});

describe("deterministic case scoring", () => {
  it("passes a complete answer and names each lost fact", () => {
    const testCase = inlineCase();
    const good = scoreCase(testCase, inlineRequest, result("Die Antwort ist 42."));
    expect(good.pass).toBe(true);
    expect(good.checks.facts).toBe(true);
    const bad = scoreCase(testCase, inlineRequest, result("Die Antwort ist bekannt."));
    expect(bad.pass).toBe(false);
    expect(bad.checks.facts).toBe(false);
    expect(bad.details.join(" ")).toContain("42");
  });

  it("fails the style/terminology invariants independently of the verifier", () => {
    const testCase = inlineCase({
      invariants: {
        requiredTerms: [{ id: "answer", any: ["Antwort"], note: "inline" }],
        forbiddenTerms: [{ id: "informal", any: ["du"], note: "inline" }],
      },
    });
    const ok = scoreCase(testCase, inlineRequest, result("Die Antwort lautet 42."));
    expect(ok.checks.terms).toBe(true);
    expect(ok.checks.forbidden).toBe(true);
    const wrong = scoreCase(testCase, inlineRequest, result("Du kennst 42, Antwort."));
    expect(wrong.checks.forbidden).toBe(false);
  });

  it("keeps the soft signals out of the pass/fail decision", () => {
    const testCase = inlineCase({
      invariants: {
        numbers: ["42"],
        expectAmbiguous: true,
        dialectMarkers: { id: "d", any: ["شو"], note: "inline" },
      },
    });
    const scored = scoreCase(testCase, inlineRequest, result("Die Antwort ist 42."));
    expect(scored.pass).toBe(true);
    expect(scored.soft.ambiguous).toBe(false);
    expect(scored.soft.dialectMarker).toBe(false);
  });
});

describe("committed baseline fixture", () => {
  it("exists, matches the frozen corpus and carries no raw run text", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      kind?: unknown;
      corpusVersion?: unknown;
      caseCount?: unknown;
      model?: unknown;
      judgeModel?: unknown;
      generatedAt?: unknown;
      configs?: { configId?: unknown; overall?: unknown; byDirection?: unknown }[];
      cases?: Record<string, unknown>[];
      recommendation?: { keepProductionFull?: unknown; rationale?: unknown };
    };
    expect(fixture.kind).toBe("translation-eval-baseline");
    expect(fixture.corpusVersion).toBe(CURRENT_CORPUS.version);
    expect(fixture.caseCount).toBe(CURRENT_CORPUS.cases.length);
    expect(fixture.model).toBe("deepseek-flash");
    expect(fixture.judgeModel).toBe("deepseek-v4-pro");
    expect(typeof fixture.generatedAt).toBe("string");
    expect(fixture.configs?.map((config) => config.configId)).toEqual([
      "production-full",
      "reasoning-high",
      "reasoning-max",
    ]);
    for (const config of fixture.configs ?? []) {
      expect(config.overall).toBeTruthy();
      expect(config.byDirection).toBeTruthy();
    }
    expect(fixture.cases?.length).toBe(CURRENT_CORPUS.cases.length * 3);
    for (const row of fixture.cases ?? []) {
      expect(typeof row["caseId"]).toBe("string");
      expect("text" in row, "raw translation text must not be committed").toBe(false);
    }
    expect(fixture.recommendation?.keepProductionFull).toBeTypeOf("boolean");
    expect(fixture.recommendation?.rationale).toBeTruthy();
    // Generated prose and bearer credentials never belong in a committed fixture.
    const fixtureText = JSON.stringify(fixture);
    expect(fixtureText).not.toMatch(/"translation":\s*"/);
    expect(fixtureText).not.toMatch(/Bearer |sk-[A-Za-z0-9]/);
  });
});

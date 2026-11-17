import { describe, expect, it } from "vitest";
import { runShadowEval, SHADOW_EVAL_CASES } from "../../../tests/eval/shadow_eval";

/**
 * Wraps the deterministic eval set (tests/eval/shadow_eval.ts) in the normal test gate.
 * No provider is called: the fixtures are source/translation pairs plus the JSON answer a
 * critic that follows the prompt contract should produce.
 */
describe("deterministic shadow eval set", () => {
  it("covers both directions, MSA and Levantine, formality and the nuance families", () => {
    const pairs = new Set(SHADOW_EVAL_CASES.map((testCase) => testCase.pair));
    expect(pairs.has("ar→de")).toBe(true);
    expect(pairs.has("de→ar")).toBe(true);
    const varieties = new Set(SHADOW_EVAL_CASES.map((testCase) => testCase.variety));
    expect(varieties.has("msa")).toBe(true);
    expect(varieties.has("levantine")).toBe(true);
    expect(SHADOW_EVAL_CASES.some((testCase) => testCase.register === "formal")).toBe(true);
    expect(SHADOW_EVAL_CASES.some((testCase) => testCase.register === "daily")).toBe(true);
    for (const feature of [
      "idiom",
      "sarcasm",
      "respect",
      "implied",
      "joke",
      "ambiguity",
      "plain",
    ]) {
      expect(
        SHADOW_EVAL_CASES.some((testCase) => testCase.feature === feature),
        `missing feature: ${feature}`,
      ).toBe(true);
    }
    // Correct translations that lost nothing are part of the set: a shadow must be able
    // to stay silent, and fabricated or merely stylistic claims must be dropped.
    expect(
      SHADOW_EVAL_CASES.filter((testCase) => testCase.expectation === "none").length,
    ).toBeGreaterThan(3);
  });

  it("passes every deterministic property", () => {
    const summary = runShadowEval();
    expect(summary.failed).toEqual([]);
    expect(summary.passed).toBe(summary.total);
  });
});

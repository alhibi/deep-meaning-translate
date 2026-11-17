import { describe, expect, it } from "vitest";
import { runShadowEval, SHADOW_EVAL_CASES } from "../../../tests/eval/shadow_eval";
import { SHADOW_WINDOW_TARGET } from "./shadow";

/**
 * The deterministic eval set is the project's touchstone for long-text and nuance quality:
 * it is fixtures plus the answer a prompt-following critic would give, so it costs nothing
 * and never flakes. This test only guards that the TD41 validation list is actually
 * present — the assertions themselves live in `runShadowEval`.
 */
const REQUIRED_DIMENSIONS = [
  "repetition",
  "diacritics",
  "compound",
  "sarcasm",
  "religion",
  "refusal",
  "ambiguity",
  "politeness",
  "paragraphs",
  "multilingual",
  "no-loss",
] as const;

describe("TD41 deterministic evaluation coverage", () => {
  it("covers every validation dimension from the task", () => {
    for (const feature of REQUIRED_DIMENSIONS) {
      expect(
        SHADOW_EVAL_CASES.some((testCase) => testCase.feature === feature),
        "missing eval dimension: " + feature,
      ).toBe(true);
    }
  });

  it("evaluates the long-text window path, not only whole short texts", () => {
    const windowed = SHADOW_EVAL_CASES.filter((testCase) => testCase.windowed);
    expect(windowed.length).toBeGreaterThan(0);
    for (const testCase of windowed) {
      // Long enough that sentence-aligned windowing is the only path.
      expect(testCase.source.length).toBeGreaterThan(SHADOW_WINDOW_TARGET * 2);
      expect(testCase.expectSourceStart).toBeGreaterThan(0);
      // The reply quotes the marker inside the source, and the target quote exists.
      expect(testCase.translation.includes("Starbucks")).toBe(true);
    }
  });

  it("carries adversarial restores whose rejection is checked exactly", () => {
    const withRestores = SHADOW_EVAL_CASES.filter((testCase) => testCase.expectRestores);
    expect(withRestores.length).toBeGreaterThan(0);
    for (const testCase of withRestores) {
      expect(testCase.reply).toBeTruthy();
      expect(testCase.expectRestores!.length).toBeGreaterThan(0);
    }
  });

  it("passes every deterministic property", () => {
    const summary = runShadowEval();
    expect(summary.failed).toEqual([]);
    expect(summary.passed).toBe(summary.total);
    expect(summary.total).toBe(SHADOW_EVAL_CASES.length);
  });
});

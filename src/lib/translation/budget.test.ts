import { describe, expect, it } from "vitest";
import { outputTokenBudget } from "./budget";

/**
 * A budget that truncates is not a budget, it is a defect: a cut structured reply is
 * invalid JSON (the verified 5,000-character failure), and a cut live reply loses its
 * ending. These tests pin the floor, the growth factor and the two protocol ceilings.
 */
describe("output token budget", () => {
  it("gives short sentences a complete floor rather than a fragment", () => {
    expect(outputTokenBudget(0, false)).toBe(256);
    expect(outputTokenBudget(0, true)).toBe(512);
    expect(outputTokenBudget(1, false)).toBe(256);
    expect(outputTokenBudget(1, true)).toBe(512);
    // A short sentence is still under the floor: it must never be cut for budget.
    expect(outputTokenBudget(120, false)).toBe(256);
    expect(outputTokenBudget(120, true)).toBe(512);
    expect(outputTokenBudget(200, true)).toBe(520);
  });

  it("grows with the source and covers a 5,000-character paste whole", () => {
    expect(outputTokenBudget(1_000, false)).toBe(1_500);
    expect(outputTokenBudget(1_000, true)).toBe(2_600);
    // Regression guard for the verified defect: 4096 tokens truncated this answer.
    expect(outputTokenBudget(5_000, true)).toBe(13_000);
    expect(outputTokenBudget(5_000, true)).toBeGreaterThan(4_096);
    expect(outputTokenBudget(5_000, false)).toBe(7_500);
  });

  it("stops at the provider ceiling for an absurdly large source", () => {
    expect(outputTokenBudget(100_000, false)).toBe(8_192);
    expect(outputTokenBudget(100_000, true)).toBe(16_384);
    expect(outputTokenBudget(Number.MAX_SAFE_INTEGER, true)).toBe(16_384);
    expect(outputTokenBudget(Number.POSITIVE_INFINITY, true)).toBe(16_384);
  });

  it("reaches the ceiling only at the source size that needs it", () => {
    // 6301 * 2.6 = 16,382.6 → 16,383, still under the cap; one more character caps.
    expect(outputTokenBudget(6_301, true)).toBe(16_383);
    expect(outputTokenBudget(6_302, true)).toBe(16_384);
    expect(outputTokenBudget(5_461, false)).toBe(8_192);
    expect(outputTokenBudget(5_462, false)).toBe(8_192);
  });

  it("never returns an invalid or negative ceiling", () => {
    for (const chars of [-10, -1, 0, 1, 999, 100_000]) {
      expect(outputTokenBudget(chars, false)).toBeGreaterThanOrEqual(256);
      expect(outputTokenBudget(chars, true)).toBeGreaterThanOrEqual(512);
    }
  });

  it("is monotonic: more source text never gets a smaller ceiling", () => {
    for (let chars = 0; chars < 7_000; chars += 137) {
      expect(outputTokenBudget(chars + 137, false)).toBeGreaterThanOrEqual(
        outputTokenBudget(chars, false),
      );
      expect(outputTokenBudget(chars + 137, true)).toBeGreaterThanOrEqual(
        outputTokenBudget(chars, true),
      );
    }
  });
});

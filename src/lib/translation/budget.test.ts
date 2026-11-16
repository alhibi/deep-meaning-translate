import { describe, expect, it } from "vitest";
import { outputTokenBudget } from "./budget";

describe("output token budget", () => {
  it("gives short sentences a complete floor rather than a fragment", () => {
    expect(outputTokenBudget(1, false)).toBe(160);
    expect(outputTokenBudget(1, true)).toBe(384);
    expect(outputTokenBudget(120, false)).toBe(162);
    expect(outputTokenBudget(120, true)).toBe(384);
  });

  it("grows with the source and stops at the protocol ceiling", () => {
    expect(outputTokenBudget(1_000, false)).toBe(1_350);
    expect(outputTokenBudget(1_000, true)).toBe(2_200);
    expect(outputTokenBudget(5_000, false)).toBe(2_048);
    expect(outputTokenBudget(5_000, true)).toBe(4_096);
    expect(outputTokenBudget(100_000, true)).toBe(4_096);
  });

  it("never returns an invalid or negative ceiling", () => {
    for (const chars of [-10, 0, 1, 999, 100_000]) {
      expect(outputTokenBudget(chars, false)).toBeGreaterThanOrEqual(160);
      expect(outputTokenBudget(chars, true)).toBeGreaterThanOrEqual(384);
    }
  });

  it("is monotonic: more source text never gets a smaller ceiling", () => {
    for (let chars = 0; chars < 5_000; chars += 137) {
      expect(outputTokenBudget(chars + 137, false)).toBeGreaterThanOrEqual(
        outputTokenBudget(chars, false),
      );
      expect(outputTokenBudget(chars + 137, true)).toBeGreaterThanOrEqual(
        outputTokenBudget(chars, true),
      );
    }
  });
});

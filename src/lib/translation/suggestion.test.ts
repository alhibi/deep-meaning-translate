import { describe, expect, it } from "vitest";
import { styleSuggestion } from "./suggestion";

/**
 * The suggestion is the only place where the app asks the writer to change something.
 * It must be rare, right, and silent when it is unsure — an unnecessary prompt is worse
 * than a missed one.
 */
describe("quiet style suggestion", () => {
  it("offers formal wording for official and work text written naturally or casually", () => {
    for (const situation of ["official", "work"]) {
      for (const style of ["natural", "casual"] as const) {
        expect(styleSuggestion({ situation, style })).toEqual({
          key: situation === "official" ? "sit_official" : "sit_work",
          next: "formal",
        });
      }
    }
  });

  it("offers casual wording only when formal text is plainly personal", () => {
    expect(styleSuggestion({ situation: "chat", style: "formal" })).toEqual({
      key: "sit_chat",
      next: "casual",
    });
  });

  it("says nothing when the chosen style already fits", () => {
    expect(styleSuggestion({ situation: "official", style: "formal" })).toBeNull();
    expect(styleSuggestion({ situation: "work", style: "formal" })).toBeNull();
    expect(styleSuggestion({ situation: "chat", style: "casual" })).toBeNull();
    expect(styleSuggestion({ situation: "chat", style: "natural" })).toBeNull();
    expect(styleSuggestion({ situation: "general", style: "formal" })).toBeNull();
    expect(styleSuggestion({ situation: "general", style: "natural" })).toBeNull();
  });

  it("stays silent when the model gave no situation at all", () => {
    expect(styleSuggestion({ situation: undefined, style: "natural" })).toBeNull();
  });
});

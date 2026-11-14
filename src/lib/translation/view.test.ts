import { describe, expect, it } from "vitest";
import { resultState } from "./view";
import type { TranslationResult } from "./types";

const result = (targetLanguage: string, translation = "Hallo"): TranslationResult => ({
  sourceLanguage: "de",
  targetLanguage,
  translation,
  tone: "",
  formality: "",
  confidence: 0.9,
  isAmbiguous: false,
  alternativeTranslations: [],
  notes: "",
});

describe("resultState", () => {
  it("never turns a mismatched model target into a pending state with no request", () => {
    // The defect: a reply that named another target language hid the result AND forced
    // `pending`, so the screen showed a skeleton forever with nothing in flight.
    const state = resultState({
      raw: result("ar"),
      rawPending: false,
      rerouting: false,
      target: "de",
    });
    expect(state.result).toBeNull();
    expect(state.stale).toBe(true);
    expect(state.pending).toBe(false);
  });

  it("shows a result that belongs to the requested target", () => {
    const state = resultState({
      raw: result("de"),
      rawPending: false,
      rerouting: false,
      target: "de",
    });
    expect(state.result?.translation).toBe("Hallo");
    expect(state.stale).toBe(false);
    expect(state.pending).toBe(false);
  });

  it("is pending only while a request runs or a re-route is under way", () => {
    expect(
      resultState({ raw: null, rawPending: true, rerouting: false, target: "de" }).pending,
    ).toBe(true);
    expect(
      resultState({ raw: result("de"), rawPending: false, rerouting: true, target: "de" }).pending,
    ).toBe(true);
    expect(
      resultState({ raw: null, rawPending: false, rerouting: false, target: "de" }).pending,
    ).toBe(false);
  });
});

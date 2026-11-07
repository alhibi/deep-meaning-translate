import { describe, expect, it } from "vitest";
import type { Session } from "../persist";
import type { TranslationResult } from "./types";
import { restorePlan } from "./restore";

const session = (over: Partial<Session> = {}): Session => ({
  text: "Guten Morgen",
  result: null,
  source: "de",
  target: "ar",
  style: "natural",
  ...over,
});

const result: TranslationResult = {
  sourceLanguage: "de",
  targetLanguage: "ar",
  translation: "صباح الخير",
  tone: "",
  formality: "",
  confidence: 1,
  isAmbiguous: false,
  alternativeTranslations: [],
  notes: "",
};

describe("restoring a saved session", () => {
  it("keeps the pair the sentence was written in, not a later preference pair", () => {
    const plan = restorePlan(session(), { source: "auto", target: "en", style: "formal" });
    expect(plan).toMatchObject({ source: "de", target: "ar", style: "natural" });
  });

  it("keeps the shown pair but tells the model auto on a strong script mismatch", () => {
    const plan = restorePlan(session({ text: "صباح الخير", source: "de" }), null);
    expect(plan.source).toBe("de");
    expect(plan.requestSource).toBe("auto");
  });

  it("honours a saved dialect and the effective brain", () => {
    const plan = restorePlan(session(), {
      source: "de",
      target: "ar",
      style: "natural",
      dialect: "levant",
      brain: "luna",
    });
    // Luna is paused: every request runs on DeepSeek even if a stale preference says otherwise.
    expect(plan.brain).toBe("deepseek");
    expect(plan.dialect).toBe("levant");
  });

  it("carries the cached result so the returning screen is not empty", () => {
    expect(restorePlan(session({ result }), null).result).toBe(result);
  });
});

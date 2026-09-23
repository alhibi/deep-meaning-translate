import { describe, expect, it } from "vitest";
import { SCHEMA_SHAPE, buildSystemPrompt, buildUserPrompt } from "./prompt";

const KEYS = [
  "translation", "sourceLanguage", "targetLanguage", "tone", "formality",
  "confidence", "isAmbiguous", "alternativeTranslations", "notes", "situation",
];

describe("prompt", () => {
  it("schema keeps every key the app parses", () => {
    for (const k of KEYS) expect(SCHEMA_SHAPE).toContain(`"${k}"`);
    expect(buildSystemPrompt().length).toBeGreaterThan(200);
  });
  it("adds dialect rules only when translating into Arabic", () => {
    const base = { text: "Hallo", source: "de", style: "natural" as const };
    expect(buildUserPrompt({ ...base, target: "ar", dialect: "levant" })).toMatch(/Levant/);
    expect(buildUserPrompt({ ...base, target: "en", dialect: "levant" })).not.toMatch(/Levant|Arabic output/);
    expect(buildUserPrompt({ ...base, target: "ar", dialect: "auto" })).not.toMatch(/Arabic output/);
  });
  it("wraps the text and marks live typing", () => {
    const p = buildUserPrompt({ text: "Hal", source: "de", target: "ar", style: "natural", partial: true });
    expect(p).toContain("<text>\nHal\n</text>");
    expect(p).not.toBe(buildUserPrompt({ text: "Hal", source: "de", target: "ar", style: "natural" }));
  });
});

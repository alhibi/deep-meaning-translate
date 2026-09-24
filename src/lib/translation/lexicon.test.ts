import { describe, expect, it } from "vitest";
import { isLexiconCandidate, parseLexicon } from "./lexicon";

describe("lexicon", () => {
  it("accepts words and short terms, but not sentences", () => {
    expect(isLexiconCandidate("sorcerer")).toBe(true);
    expect(isLexiconCandidate("machine learning")).toBe(true);
    expect(isLexiconCandidate("عبد الرحمن")).toBe(true);
    expect(isLexiconCandidate("Can you help me tomorrow?")).toBe(false);
    expect(isLexiconCandidate("هذا نص طويل يحتوي على كلمات كثيرة")).toBe(false);
    expect(isLexiconCandidate("word.")).toBe(false);
  });

  it("keeps valid entries, drops malformed entries, and sorts the best match first", () => {
    const parsed = parseLexicon({
      sourceTerm: "sorcerer",
      sourceLanguage: "en",
      targetLanguage: "ar",
      entries: [
        { term: "مشعوذ", partOfSpeech: "noun", meanings: ["دجال"], definition: "", example: "", exampleTranslation: "", primary: false },
        { term: "ساحر", partOfSpeech: "noun", meanings: ["من يمارس السحر"], definition: "الأكثر شيوعاً", example: "The sorcerer arrived.", exampleTranslation: "وصل الساحر.", primary: true },
        { term: "broken", partOfSpeech: "unknown", meanings: [] },
      ],
    });
    expect(parsed?.entries).toHaveLength(2);
    expect(parsed?.entries[0]?.term).toBe("ساحر");
  });

  it("silently rejects unusable provider data", () => {
    expect(parseLexicon(null)).toBeNull();
    expect(parseLexicon({ sourceTerm: "x", sourceLanguage: "en", targetLanguage: "de", entries: [] })).toBeNull();
  });
});
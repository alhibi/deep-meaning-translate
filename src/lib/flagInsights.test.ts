import { describe, expect, it } from "vitest";
import { isFlag, wordsOf, type Flag } from "./flags";
import { tipsFor, wordStats } from "./flagInsights";

const f = (o: Partial<Flag>): Flag => ({
  id: Math.random().toString(),
  source: "de",
  target: "ar",
  original: "Ich gehe heute nach Hause",
  translated: "أذهب اليوم إلى البيت",
  words: [],
  brain: "deepseek",
  createdAt: 1,
  ...o,
});

describe("inaccuracy insights", () => {
  it("counts marked words per language, most frequent first", () => {
    const s = wordStats([f({ words: ["البيت"] }), f({ words: ["البيت", "أذهب"] })]);
    expect(s[0]).toMatchObject({ word: "البيت", count: 2 });
    expect(s).toHaveLength(2);
  });
  it("a single flag never produces a suggestion", () => {
    expect(tipsFor([f({ words: ["البيت"], original: "Haus" })])).toEqual([]);
  });
  it("a word marked twice yields a recurring-word suggestion", () => {
    const tips = tipsFor([f({ words: ["البيت"] }), f({ words: ["البيت"] })]);
    expect(tips).toContainEqual({ kind: "recurring", word: "البيت", count: 2 });
  });
  it("mostly short texts suggest a single-word rule", () => {
    expect(tipsFor([f({ original: "Haus" }), f({ original: "Bank" })])).toContainEqual({ kind: "short", count: 2 });
  });
  it("word splitting drops punctuation; validator rejects damaged rows", () => {
    expect(wordsOf("مرحباً، كيف حالك؟")).toEqual(["مرحباً", "كيف", "حالك"]);
    expect(isFlag({ ...f({}), words: [1] })).toBe(false);
    expect(isFlag(f({}))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  LEXICON_MAX_TERM_CODE_POINTS,
  LEXICON_MAX_TERM_WORDS,
  isLexiconCandidate,
} from "./lexicon";

/**
 * The gate is a cheap local filter: a false negative only hides the dictionary for an
 * unusual phrase, while a sentence sent to the analysis model wastes a quiet request. These
 * tests pin both sides of that trade-off and the exact limits.
 */
describe("isLexiconCandidate limits", () => {
  it("always accepts single words, short terms and proper names", () => {
    expect(isLexiconCandidate("sorcerer")).toBe(true);
    expect(isLexiconCandidate("machine learning")).toBe(true);
    expect(isLexiconCandidate("عبد الرحمن")).toBe(true);
    expect(isLexiconCandidate("Straßenbahnhaltestelle")).toBe(true);
  });

  it("expands to idioms and short fixed phrases of up to ten words", () => {
    expect(isLexiconCandidate("the early bird catches the worm")).toBe(true);
    expect(isLexiconCandidate("to kill two birds with one stone")).toBe(true);
    expect(isLexiconCandidate("the early bird catches the worm before the sun rises")).toBe(true);
    expect(isLexiconCandidate("der Apfel fällt nicht weit vom Stamm")).toBe(true);
    // Inner commas, apostrophes and hyphens belong to idioms, not to sentence boundaries.
    expect(isLexiconCandidate("the early bird, so to speak")).toBe(true);
    expect(isLexiconCandidate("d'un coup")).toBe(true);
    expect(isLexiconCandidate("a bird in the hand is worth two in the bush")).toBe(false);
    expect("the early bird catches the worm before the sun rises".split(" ")).toHaveLength(
      LEXICON_MAX_TERM_WORDS,
    );
    expect(isLexiconCandidate("the early bird catches the worm before the sun rises today")).toBe(
      false,
    );
  });

  it("refuses prose: terminal punctuation, newlines and clauses built around a pronoun", () => {
    expect(isLexiconCandidate("Can you help me tomorrow?")).toBe(false);
    expect(isLexiconCandidate("this is a long text about many words")).toBe(false);
    expect(isLexiconCandidate("I think we should leave now")).toBe(false);
    expect(isLexiconCandidate("ich weiß nicht was du meinst")).toBe(false);
    expect(isLexiconCandidate("هذا نص طويل يحتوي على كلمات كثيرة")).toBe(false);
    expect(isLexiconCandidate("word.")).toBe(false);
    expect(isLexiconCandidate("word!")).toBe(false);
    expect(isLexiconCandidate("word؟")).toBe(false);
    expect(isLexiconCandidate("word;")).toBe(false);
    expect(isLexiconCandidate("word:")).toBe(false);
    expect(isLexiconCandidate("word…")).toBe(false);
    expect(isLexiconCandidate("first line\nsecond line")).toBe(false);
  });

  it("bounds the term by code points, not UTF-16 units, so astral characters count once", () => {
    expect(Array.from("x".repeat(LEXICON_MAX_TERM_CODE_POINTS))).toHaveLength(
      LEXICON_MAX_TERM_CODE_POINTS,
    );
    expect(isLexiconCandidate("x".repeat(LEXICON_MAX_TERM_CODE_POINTS))).toBe(true);
    expect(isLexiconCandidate("x".repeat(LEXICON_MAX_TERM_CODE_POINTS + 1))).toBe(false);
    // 96 astral code points are 192 UTF-16 units; the gate must not split the last pair.
    const astral = `a${"\u{1F600}".repeat(LEXICON_MAX_TERM_CODE_POINTS - 1)}`;
    expect(Array.from(astral)).toHaveLength(LEXICON_MAX_TERM_CODE_POINTS);
    expect(isLexiconCandidate(astral)).toBe(true);
    expect(isLexiconCandidate(`a${"\u{1F600}".repeat(LEXICON_MAX_TERM_CODE_POINTS)}`)).toBe(false);
  });

  it("still requires at least one letter or digit and ignores blank input", () => {
    expect(isLexiconCandidate("")).toBe(false);
    expect(isLexiconCandidate("   ")).toBe(false);
    // Digits are allowed (a term can be "1979" or "3D"); only symbols-only input is refused.
    expect(isLexiconCandidate("123 456")).toBe(true);
    expect(isLexiconCandidate("!!! ***")).toBe(false);
    expect(isLexiconCandidate("\n\r\t")).toBe(false);
  });
});

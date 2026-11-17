import { describe, expect, it } from "vitest";
import {
  LEXICON_MAX_TERM_CODE_POINTS,
  LEXICON_MAX_TERM_WORDS,
  classifyLexiconCandidate,
  isLexiconCandidate,
} from "./lexicon";

/**
 * The candidate gate is a cheap local classifier (TD43). A false negative only hides the
 * dictionary for an unusual phrase, while a false positive spends one quiet analysis request
 * whose documented model reply is the literal null. These tests pin both sides of that
 * trade-off, the exact limits, and the rejection reason for every rule, so the classifier is
 * explainable rather than a pile of guesses.
 */
const rejection = (text: string) => {
  const verdict = classifyLexiconCandidate(text);
  return verdict.accepted ? null : verdict.reason;
};
const accepts = (text: string) => isLexiconCandidate(text);

describe("isLexiconCandidate — lexical units stay admissible", () => {
  it("accepts single words, names, compounds and short terms", () => {
    for (const value of [
      "sorcerer",
      "machine learning",
      "عبد الرحمن",
      "Straßenbahnhaltestelle",
      "New York",
      "3D-Drucker",
      "e-mail",
      "d'un coup",
      "اللغة العربية",
      "sorcerer's apprentice",
    ]) {
      expect(accepts(value), value).toBe(true);
    }
  });

  it("keeps genuine idioms and fixed expressions admissible", () => {
    for (const value of [
      // The examples from TD43's requirement.
      "ins kalte Wasser springen",
      "على راسي",
      "اللي فات مات",
      // Verb-phrase idioms: no subject, no finite clause.
      "auf den Arm nehmen",
      "die Katze aus dem Sack lassen",
      "to kill two birds with one stone",
      "at the end of the day",
      "once in a blue moon",
      "mit Sack und Pack",
      "null und nichtig",
      // Clause-shaped proverbs are in the reviewed fixed-expression corpus.
      "der Apfel fällt nicht weit vom Stamm",
      "the early bird catches the worm",
      "wer zuletzt lacht, lacht am besten",
      "der frühe Vogel fängt den Wurm",
      "no time like the present",
      "خير الكلام ما قل ودل",
      "من حفر حفرة لأخيه وقع فيها",
      // A parenthetical aside is not a clause.
      "the early bird, so to speak",
    ]) {
      expect(accepts(value), value).toBe(true);
    }
  });

  it("keeps one- and two-word lookups that are questions or requests as words", () => {
    for (const value of ["why", "why not", "how come", "wie geht's", "bitte schön", "من فضلك"]) {
      expect(accepts(value), value).toBe(true);
    }
  });

  it("strips display wrappers and invisible characters before classifying", () => {
    expect(accepts("«كلمة»")).toBe(true);
    expect(accepts('"bank"')).toBe(true);
    expect(accepts("(d'un coup)")).toBe(true);
    expect(accepts("sor\u200Bcerer")).toBe(true);
    expect(rejection('"Can you help me tomorrow?"')).toBe("sentence_punctuation");
  });
});

describe("isLexiconCandidate — sentences and prose are refused", () => {
  it("refuses a short clause that has no pronoun but has a finite verb", () => {
    for (const value of [
      "meeting moved to friday morning",
      "the manager approved the budget",
      "the parcel arrived early today",
      "the office closed on monday",
      "the team reported the loss",
      "die Lieferung kam heute Morgen an",
      "das Treffen findet morgen im Büro statt",
    ]) {
      expect(rejection(value), value).toBe("sentence_shape");
    }
  });

  it("refuses Arabic and dialect clauses with a finite verb", () => {
    expect(rejection("ذهبت إلى السوق صباح اليوم")).toBe("sentence_shape");
    expect(rejection("وصلت الحقيبة إلى المكتب صباح اليوم")).toBe("sentence_shape");
    // Dialect spelling, typed the way speakers write it: ب + يقول → قول, and رحت → روح.
    expect(rejection("بيقول إنه رح يجي بكرا الصبح")).toBe("sentence_shape");
    expect(rejection("رحت على السوق واشتريت خبز اليوم")).toBe("sentence_shape");
  });

  it("refuses questions in every supported language", () => {
    const cases: [string, string][] = [
      ["where are we going", "question"],
      ["why is the sky blue", "question"],
      ["what time does the train leave", "question"],
      ["Can you help me", "question"],
      ["Would you like some tea", "question"],
      ["wie geht es dir heute", "question"],
      ["Warum kommst du so spät", "question"],
      ["Kannst du mir helfen", "question"],
      ["هل هذا صحيح", "question"],
      ["لماذا تأخرت اليوم", "question"],
      ["ليش تأخرت اليوم", "question"],
    ];
    for (const [value, reason] of cases) expect(rejection(value), value).toBe(reason);
  });

  it("refuses request sentences, never lexical phrases of the same words", () => {
    expect(rejection("send the file please")).toBe("request");
    expect(rejection("bitte senden Sie die Datei")).toBe("request");
    expect(rejection("أرسل الملف من فضلك")).toBe("request");
    expect(rejection("close the window please")).toBe("request");
  });

  it("refuses clause scaffolds beyond four words (pronoun, auxiliary, negation)", () => {
    const cases: [string, string][] = [
      ["this is a long text about many words", "clause_scaffold"],
      ["I think we should leave now", "clause_scaffold"],
      ["ich weiß nicht was du meinst", "clause_scaffold"],
      ["der Termin wurde auf Freitag verschoben", "clause_scaffold"],
      ["der Vertrag ist noch nicht unterschrieben", "clause_scaffold"],
      ["هذا نص طويل يحتوي على كلمات كثيرة", "clause_scaffold"],
      ["الكتاب الذي قرأته كان ممتعا", "clause_scaffold"],
    ];
    for (const [value, reason] of cases) expect(rejection(value), value).toBe(reason);
  });

  it("refuses multi-clause text with a clause conjunction", () => {
    expect(rejection("came home and cooked dinner")).toBe("multi_clause");
    expect(rejection("kam nach Hause und kochte")).toBe("multi_clause");
    expect(rejection("المشروع جيد لكن الميزانية قليلة")).toBe("multi_clause");
  });

  it("refuses terminal punctuation, newlines and symbols-only input", () => {
    for (const value of [
      "word.",
      "word!",
      "word؟",
      "word;",
      "word:",
      "word…",
      "first line\nsecond line",
      "Was ist das?",
      "هل هذا صحيح؟",
    ]) {
      expect(rejection(value), value).toBe("sentence_punctuation");
    }
    expect(rejection("")).toBe("empty");
    expect(rejection("   ")).toBe("empty");
    expect(rejection("!!! ***")).toBe("no_letters");
    expect(rejection("\n\r\t")).toBe("empty");
  });

  it("keeps the four-word floor: lexical units with pronoun, negation or verb survive", () => {
    for (const value of [
      "thank you",
      "no worries",
      "never mind",
      "never again",
      "ins kalte Wasser",
    ]) {
      expect(accepts(value), value).toBe(true);
    }
  });
});

describe("isLexiconCandidate — exact limits", () => {
  it("bounds the term by code points, not UTF-16 units, so astral characters count once", () => {
    expect(Array.from("x".repeat(LEXICON_MAX_TERM_CODE_POINTS))).toHaveLength(
      LEXICON_MAX_TERM_CODE_POINTS,
    );
    expect(accepts("x".repeat(LEXICON_MAX_TERM_CODE_POINTS))).toBe(true);
    expect(rejection("x".repeat(LEXICON_MAX_TERM_CODE_POINTS + 1))).toBe("too_long");
    // 96 astral code points are 192 UTF-16 units; the gate must not split the last pair.
    const astral = `a${"\u{1F600}".repeat(LEXICON_MAX_TERM_CODE_POINTS - 1)}`;
    expect(Array.from(astral)).toHaveLength(LEXICON_MAX_TERM_CODE_POINTS);
    expect(accepts(astral)).toBe(true);
    expect(rejection(`a${"\u{1F600}".repeat(LEXICON_MAX_TERM_CODE_POINTS)}`)).toBe("too_long");
  });

  it("bounds the word count at ten", () => {
    expect(LEXICON_MAX_TERM_WORDS).toBe(10);
    expect(rejection("the early bird catches the worm before the sun rises today")).toBe(
      "too_many_words",
    );
    expect(rejection("a bird in the hand is worth two in the bush")).toBe("too_many_words");
    // Ten words is the allowed maximum; the extension that adds an 11th word is prose.
    expect(rejection("the early bird catches the worm before the sun rises")).not.toBe(
      "too_many_words",
    );
  });

  it("still requires at least one letter or digit", () => {
    // Digits are allowed (a term can be "1979" or "3D"); only symbols-only input is refused.
    expect(accepts("123 456")).toBe(true);
    expect(rejection("— — —")).toBe("no_letters");
  });
});

describe("isLexiconCandidate — classifier contract", () => {
  it("is deterministic and never throws on hostile input", () => {
    const inputs = [
      "sorcerer",
      "",
      " ".repeat(2000),
      "\u0000",
      "\u{1F600}".repeat(120),
      "a".repeat(5000),
      "wOrd.".repeat(300),
      "على راسي",
      "«".repeat(50),
      '"',
    ];
    for (const value of inputs) {
      const first = classifyLexiconCandidate(value);
      expect(classifyLexiconCandidate(value)).toEqual(first);
    }
  });

  it("reports a reason for every rejection and none for every acceptance", () => {
    const rejected = [
      "word.",
      "x".repeat(200),
      "the office closed on monday",
      "where are we going",
      "send the file please",
      "der Termin wurde auf Freitag verschoben",
      "came home and cooked dinner",
      "!!!",
      "",
    ];
    for (const value of rejected) {
      const verdict = classifyLexiconCandidate(value);
      expect(verdict.accepted).toBe(false);
      if (!verdict.accepted) expect(verdict.reason).toBeTypeOf("string");
    }
    expect(classifyLexiconCandidate("sorcerer")).toEqual({ accepted: true });
  });
});

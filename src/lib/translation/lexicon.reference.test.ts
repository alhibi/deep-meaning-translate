import { describe, expect, it } from "vitest";
import {
  LEXICAL_KINDS,
  LEXICON_SYSTEM,
  MAX_COLLOCATIONS,
  MAX_ENTRIES,
  MAX_EXAMPLES,
  MAX_FORMS,
  MAX_MEANINGS,
  MAX_NUANCES,
  MAX_SYNONYMS,
  NUANCE_KINDS,
  applyLexiconRequestContext,
  lexiconUserPrompt,
  parseLexicon,
  rankMeanings,
  readLexiconReply,
} from "./lexicon";

/** The shape the pre-reference prompt produced: one flat example, no reference sections. */
const legacyPayload = {
  sourceTerm: "Bank",
  sourceLanguage: "de",
  targetLanguage: "ar",
  translation: "مصرف",
  entries: [
    {
      term: "بنك",
      partOfSpeech: "noun",
      meanings: ["مصرف", "بنك"],
      definition: "مؤسسة مالية",
      example: "Die Bank öffnet um neun.",
      exampleTranslation: "يفتح المصرف عند التاسعة.",
      primary: true,
      forms: ["die Bank", "die Banken"],
      synonyms: ["مصرف"],
      frequency: 0.9,
      register: "neutral",
    },
    {
      term: "ضفة",
      partOfSpeech: "noun",
      meanings: ["ضفة النهر"],
      primary: false,
      frequency: 0.4,
    },
  ],
};

const referencePayload = {
  sourceTerm: "bekommen",
  sourceLanguage: "de",
  targetLanguage: "ar",
  translation: "يحصل على",
  entries: [
    {
      term: "حصل على",
      lemma: "bekommen",
      partOfSpeech: "verb",
      meanings: ["حصل على", "نال"],
      definition: "يحصل على شيء، وليس «يصبح».",
      primary: true,
      frequency: 0.9,
      register: "neutral",
      variety: "MSA",
      forms: ["Präteritum: bekam", "Perfekt: hat bekommen", "Präposition: von"],
      synonyms: ["نال", "أخذ"],
      collocations: ["bekommen von", "zu sehen bekommen"],
      examples: [{ text: "Ich habe einen Brief bekommen.", translation: "حصلت على رسالة." }],
      nuances: [
        {
          kind: "false_friend",
          text: "«bekommen» ليست «become»؛ «become» هي «werden».",
        },
        { kind: "near_synonym", text: "«نال» أقوى وأكثر رسمية، ولا تصلح في الكلام اليومي." },
      ],
      pronunciation: "bəˈkɔmən",
    },
  ],
};

describe("lexicon reference schema", () => {
  it("accepts the pre-reference schema and labels it model-generated", () => {
    const parsed = parseLexicon(legacyPayload);
    expect(parsed).not.toBeNull();
    // The parser, never the model, decides that this is a model reading.
    expect(parsed?.source).toBe("model");
    expect(parsed?.translation).toBe("مصرف");
    expect(parsed?.entries[0]?.term).toBe("بنك");
    expect(parsed?.entries[0]?.forms).toEqual(["die Bank", "die Banken"]);
    expect(parsed?.entries[0]?.synonyms).toEqual(["مصرف"]);
    // The old flat example is normalized into the reference list, so one renderer works.
    expect(parsed?.entries[0]?.examples[0]).toEqual({
      text: "Die Bank öffnet um neun.",
      translation: "يفتح المصرف عند التاسعة.",
    });
    expect(parsed?.entries[1]?.examples).toEqual([]);
    expect(parsed?.entries[1]?.nuances).toEqual([]);
  });

  it("ignores a payload that claims to be verified and always marks it as a model reading", () => {
    const parsed = parseLexicon({ ...legacyPayload, source: "verified-dictionary" });
    expect(parsed?.source).toBe("model");
  });

  it("accepts the reference schema with labelled forms, examples, nuance kinds and pronunciation", () => {
    const parsed = parseLexicon(referencePayload);
    const entry = parsed?.entries[0];
    expect(entry?.lemma).toBe("bekommen");
    expect(entry?.forms).toHaveLength(3);
    expect(entry?.collocations).toEqual(["bekommen von", "zu sehen bekommen"]);
    expect(entry?.examples).toEqual([
      { text: "Ich habe einen Brief bekommen.", translation: "حصلت على رسالة." },
    ]);
    expect(entry?.nuances.map((nuance) => nuance.kind)).toEqual(["false_friend", "near_synonym"]);
    expect(entry?.pronunciation).toBe("bəˈkɔmən");
    expect(entry?.variety).toBe("MSA");
    expect(entry?.register).toBe("neutral");
  });

  it("discards junk entries and unknown nuance kinds instead of failing the result", () => {
    const parsed = parseLexicon({
      sourceTerm: "Bank",
      sourceLanguage: "de",
      targetLanguage: "ar",
      entries: [
        legacyPayload.entries[0],
        null,
        42,
        "nonsense",
        { term: "x", partOfSpeech: "unknown", meanings: ["y"] },
        { term: "y", partOfSpeech: "noun", meanings: [] },
        { term: "", partOfSpeech: "noun", meanings: ["z"] },
      ],
    });
    expect(parsed?.entries).toHaveLength(1);
    expect(parsed?.entries[0]?.term).toBe("بنك");

    const nuanced = parseLexicon({
      ...referencePayload,
      entries: [
        {
          ...referencePayload.entries[0],
          nuances: [
            { kind: "not-a-kind", text: "x" },
            { kind: "near-synonym", text: "alias kind is normalized" },
            { kind: "idiom", text: "keep me" },
          ],
        },
      ],
    });
    expect(nuanced?.entries[0]?.nuances.map((nuance) => nuance.kind)).toEqual([
      "near_synonym",
      "idiom",
    ]);
  });

  it("bounds every list and section, never letting the model grow a dictionary page", () => {
    const parsed = parseLexicon({
      sourceTerm: "word",
      sourceLanguage: "en",
      targetLanguage: "de",
      entries: Array.from({ length: 14 }, (_, index) => ({
        term: `term${index}`,
        partOfSpeech: "noun",
        meanings: Array.from({ length: 9 }, (_, i) => `meaning-${index}-${i}`),
        forms: Array.from({ length: 12 }, (_, i) => `form-${i}`),
        synonyms: Array.from({ length: 12 }, (_, i) => `synonym-${i}`),
        collocations: Array.from({ length: 12 }, (_, i) => `collocation-${i}`),
        nuances: Array.from({ length: 12 }, (_, i) => ({ kind: "shift", text: `nuance ${i}` })),
        examples: Array.from({ length: 6 }, (_, i) => ({ text: `example ${i}`, translation: "" })),
      })),
    });
    expect(parsed?.entries).toHaveLength(MAX_ENTRIES);
    const entry = parsed?.entries[0];
    expect(entry?.meanings).toHaveLength(MAX_MEANINGS);
    expect(entry?.forms).toHaveLength(MAX_FORMS);
    expect(entry?.synonyms).toHaveLength(MAX_SYNONYMS);
    expect(entry?.collocations).toHaveLength(MAX_COLLOCATIONS);
    expect(entry?.nuances).toHaveLength(MAX_NUANCES);
    expect(entry?.examples).toHaveLength(MAX_EXAMPLES);
  });

  it("deduplicates repeated forms, synonyms and readings", () => {
    const parsed = parseLexicon({
      sourceTerm: "Bank",
      sourceLanguage: "de",
      targetLanguage: "ar",
      entries: [
        {
          term: "بنك",
          partOfSpeech: "noun",
          meanings: ["مصرف", "مصرف", "بنك"],
          forms: ["die Bank", "die Bank", "die Bänke"],
          synonyms: ["مصرف", "مصرف", "بنك"],
        },
      ],
    });
    expect(parsed?.entries[0]?.meanings).toEqual(["مصرف", "بنك"]);
    expect(parsed?.entries[0]?.forms).toEqual(["die Bank", "die Bänke"]);
    expect(parsed?.entries[0]?.synonyms).toEqual(["مصرف", "بنك"]);
  });
});

describe("lexicon context ranking", () => {
  it("puts the reading the sentence selected first, then the in-context flag, then frequency", () => {
    const parsed = parseLexicon({
      sourceTerm: "Bank",
      sourceLanguage: "de",
      targetLanguage: "ar",
      translation: "مقعد الحديقة",
      entries: [
        {
          term: "بنك",
          partOfSpeech: "noun",
          meanings: ["مصرف"],
          primary: false,
          frequency: 0.9,
        },
        {
          term: "مقعد",
          partOfSpeech: "noun",
          meanings: ["كرسي طويل", "مقعد الحديقة"],
          primary: true,
          frequency: 0.6,
        },
        {
          term: "ضفة",
          partOfSpeech: "noun",
          meanings: ["ضفة النهر"],
          primary: false,
          frequency: 0.4,
        },
      ],
    });
    // "مقعد" is the only entry matching the model translation, so it leads even though
    // "بنك" is more frequent; the translation is the sentence context we have.
    expect(parsed?.entries[0]?.term).toBe("مقعد");
    // Within that entry, the selected reading is the first one.
    expect(parsed?.entries[0]?.meanings[0]).toBe("مقعد الحديقة");
    expect(parsed?.entries[1]?.term).toBe("بنك");
  });

  it("rankMeanings is deterministic and leaves unmatched readings in model order", () => {
    expect(rankMeanings(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(rankMeanings(["a", "b", "c"], "b")).toEqual(rankMeanings(["a", "b", "c"], "b"));
    expect(rankMeanings(["a", "b", "c"], "zzz")).toEqual(["a", "b", "c"]);
    expect(rankMeanings([], "b")).toEqual([]);
  });
});

describe("lexicon request context echo", () => {
  const parsed = parseLexicon(legacyPayload)!;

  it("echoes the register and the Arabic variety, but only shows a context that adds information", () => {
    const echoed = applyLexiconRequestContext(parsed, {
      text: "Bank",
      style: "formal",
      dialect: "levant",
      context: "Die Bank ist heute geschlossen.",
    });
    expect(echoed.source).toBe("model");
    expect(echoed.style).toBe("formal");
    expect(echoed.dialect).toBe("levant");
    expect(echoed.context).toBe("Die Bank ist heute geschlossen.");

    const sameAsTerm = applyLexiconRequestContext(parsed, { text: "Bank", context: "  bank  " });
    expect(sameAsTerm.context).toBeUndefined();
  });

  it("never attaches an Arabic variety to a non-Arabic target", () => {
    const german = { ...parsed, targetLanguage: "de" };
    const echoed = applyLexiconRequestContext(german, { text: "Bank", dialect: "levant" });
    expect(echoed.dialect).toBeUndefined();
  });
});

describe("lexicon prompt and reply", () => {
  it("asks for exactly the schema the parser reads", () => {
    const prompt = lexiconUserPrompt({
      text: "Bank",
      source: "de",
      target: "ar",
      uiLocale: "ar",
      translation: "مصرف",
      context: "Die Bank ist heute geschlossen.",
      style: "formal",
      dialect: "levant",
    });
    expect(prompt).toContain("UI language: ar");
    expect(prompt).toContain("Direction: de→ar");
    expect(prompt).toContain("Style: formal");
    expect(prompt).toContain("Arabic dialect: levant");
    expect(prompt).toContain("Model translation of the term: مصرف");
    expect(prompt).toContain("<sentence>\nDie Bank ist heute geschlossen.\n</sentence>");
    expect(prompt).toContain("<term>\nBank\n</term>");

    const schemaKeys = [
      "sourceTerm",
      "sourceLanguage",
      "targetLanguage",
      "translation",
      "entries",
      "term",
      "lemma",
      "partOfSpeech",
      "meanings",
      "definition",
      "primary",
      "frequency",
      "register",
      "variety",
      "forms",
      "synonyms",
      "collocations",
      "examples",
      "nuances",
      "pronunciation",
      "kind",
    ];
    for (const key of schemaKeys) expect(LEXICON_SYSTEM).toContain(`"${key}"`);
    for (const kind of LEXICAL_KINDS) expect(LEXICON_SYSTEM).toContain(kind);
    for (const kind of NUANCE_KINDS) expect(LEXICON_SYSTEM).toContain(`"${kind}"`);
    expect(LEXICON_SYSTEM).toContain("literal null");
    // The headword shown in the UI is a target-language word, never the source echo.
    expect(LEXICON_SYSTEM).toContain("target-language headword");
  });

  it("does not send the sentence twice when it is the term itself", () => {
    const prompt = lexiconUserPrompt({
      text: "bank",
      source: "en",
      target: "ar",
      uiLocale: "en",
      context: "  bank ",
    });
    expect(prompt).not.toContain("<sentence>");
  });

  it("reads valid JSON, fenced JSON and the literal null, and rejects everything else", () => {
    expect(readLexiconReply("null")).toBeNull();
    expect(readLexiconReply("  null  ")).toBeNull();
    expect(readLexiconReply("not json")).toBeNull();
    expect(readLexiconReply('{"sourceTerm":"x"')).toBeNull();
    expect(readLexiconReply("42")).toBeNull();
    expect(readLexiconReply(JSON.stringify({ ...legacyPayload, entries: [] }))).toBeNull();
    expect(
      readLexiconReply(`\`\`\`json\n${JSON.stringify(legacyPayload)}\n\`\`\``)?.sourceTerm,
    ).toBe("Bank");
    expect(readLexiconReply(JSON.stringify(legacyPayload))?.entries).toHaveLength(2);
  });

  it("never throws, even for hostile structures", () => {
    const hostile = {
      get sourceTerm(): string {
        throw new Error("boom");
      },
    };
    expect(() => parseLexicon(hostile)).not.toThrow();
    expect(parseLexicon(hostile)).toBeNull();
    for (const junk of [undefined, null, 0, false, "", [], "text", { entries: "x" }]) {
      expect(() => parseLexicon(junk)).not.toThrow();
      expect(parseLexicon(junk)).toBeNull();
    }
  });
});

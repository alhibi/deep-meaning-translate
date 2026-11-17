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
  rankEntries,
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
      // Flat example: target-language sentence plus its UI-language translation.
      example: "أفتح المصرف عند التاسعة.",
      exampleTranslation: "The bank opens at nine.",
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
      collocations: ["يحصل على", "حصل على شيء"],
      examples: [{ text: "حصلت على رسالة.", translation: "I received a letter." }],
      nuances: [
        { kind: "false_friend", text: "«bekommen» ليست «become»؛ «become» هي «werden»." },
        { kind: "near_synonym", text: "«نال» أقوى وأكثر رسمية، ولا تصلح في الكلام اليومي." },
      ],
      pronunciation: "bəˈkɔmən",
    },
  ],
};

const withLanguages = (
  targetLanguage: string,
  sourceLanguage: string,
  entries: unknown[],
  translation = "",
) => ({ sourceTerm: "term", sourceLanguage, targetLanguage, translation, entries });

const noun = (overrides: Record<string, unknown> = {}) => ({
  term: "بيت",
  partOfSpeech: "noun",
  meanings: ["house"],
  ...overrides,
});

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
      text: "أفتح المصرف عند التاسعة.",
      translation: "The bank opens at nine.",
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
    expect(entry?.collocations).toEqual(["يحصل على", "حصل على شيء"]);
    expect(entry?.examples).toEqual([
      { text: "حصلت على رسالة.", translation: "I received a letter." },
    ]);
    expect(entry?.nuances.map((nuance) => nuance.kind)).toEqual(["false_friend", "near_synonym"]);
    expect(entry?.pronunciation).toBe("bəˈkɔmən");
    expect(entry?.variety).toBe("MSA");
    expect(entry?.register).toBe("neutral");
  });

  it("normalizes ISO 639-2 language codes and refuses unusable ones", () => {
    const parsed = parseLexicon({
      sourceTerm: "bekommen",
      sourceLanguage: "deu",
      targetLanguage: "ara",
      entries: [referencePayload.entries[0]],
    });
    expect(parsed?.sourceLanguage).toBe("de");
    expect(parsed?.targetLanguage).toBe("ar");
    expect(parseLexicon({ ...legacyPayload, targetLanguage: "" })).toBeNull();
    expect(parseLexicon({ ...legacyPayload, sourceLanguage: "german" })).toBeNull();
  });

  it("discards junk entries and unknown nuance kinds instead of failing the result", () => {
    const parsed = parseLexicon({
      ...legacyPayload,
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
        term: `Wort${index}`,
        partOfSpeech: "noun",
        meanings: Array.from({ length: 9 }, (_, i) => `Bedeutung-${index}-${i}`),
        forms: Array.from({ length: 12 }, (_, i) => `Form-${i}`),
        synonyms: Array.from({ length: 12 }, (_, i) => `Synonym-${i}`),
        collocations: Array.from({ length: 12 }, (_, i) => `Kollokation-${i}`),
        nuances: Array.from({ length: 12 }, (_, i) => ({ kind: "shift", text: `Nuance ${i}` })),
        examples: Array.from({ length: 6 }, (_, i) => ({
          text: `Beispiel ${i}.`,
          translation: `Example ${i}.`,
        })),
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

  it("deduplicates repeated forms, synonyms, readings and entries", () => {
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
        { term: "بنك", partOfSpeech: "noun", meanings: ["مؤسسة"] },
      ],
    });
    expect(parsed?.entries).toHaveLength(1);
    expect(parsed?.entries[0]?.meanings).toEqual(["مصرف", "بنك"]);
    expect(parsed?.entries[0]?.forms).toEqual(["die Bank", "die Bänke"]);
    expect(parsed?.entries[0]?.synonyms).toEqual(["مصرف", "بنك"]);
  });
});

describe("lexicon language integrity", () => {
  it("drops a headword in the wrong script for the target language", () => {
    // de→ar: a Latin "bank" is the source term, not the target headword.
    expect(
      parseLexicon({
        sourceTerm: "bank",
        sourceLanguage: "de",
        targetLanguage: "ar",
        entries: [{ term: "bank", partOfSpeech: "noun", meanings: ["مصرف"] }],
      }),
    ).toBeNull();
    // ar→de: an Arabic headword is the source term, not the German headword.
    expect(
      parseLexicon({
        sourceTerm: "بيت",
        sourceLanguage: "ar",
        targetLanguage: "de",
        entries: [{ term: "بيت", partOfSpeech: "noun", meanings: ["Haus"] }],
      }),
    ).toBeNull();
  });

  it("drops readings written in the source language and keeps only real target readings", () => {
    const parsed = parseLexicon({
      sourceTerm: "bekommen",
      sourceLanguage: "de",
      targetLanguage: "ar",
      entries: [
        {
          term: "حصل على",
          partOfSpeech: "verb",
          meanings: ["bekommen", "حصل على", "نال"],
          synonyms: ["bekommen", "نال"],
          collocations: ["bekommen von", "تحصل على"],
        },
      ],
    });
    expect(parsed?.entries[0]?.meanings).toEqual(["حصل على", "نال"]);
    expect(parsed?.entries[0]?.synonyms).toEqual(["نال"]);
    expect(parsed?.entries[0]?.collocations).toEqual(["تحصل على"]);
  });

  it("never renders target-language analysis of a source term that is only a transliteration", () => {
    // The source term is Arabic but typed in Latin letters; a Latin headword for the German
    // target must not be accepted when it is only an echo of that source term.
    const parsed = parseLexicon({
      sourceTerm: "Bank",
      sourceLanguage: "ar",
      targetLanguage: "de",
      entries: [{ term: "Bank", partOfSpeech: "noun", meanings: ["Sitzbank"] }],
    });
    expect(parsed).toBeNull();
  });

  it("removes non-answer readings instead of showing them as facts", () => {
    const parsed = parseLexicon({
      sourceTerm: "bekommen",
      sourceLanguage: "de",
      targetLanguage: "ar",
      entries: [
        {
          term: "حصل على",
          partOfSpeech: "verb",
          meanings: ["N/A", "غير معروف", "—", "unknown", "نال"],
        },
      ],
    });
    expect(parsed?.entries[0]?.meanings).toEqual(["نال"]);

    const onlyJunk = parseLexicon({
      sourceTerm: "bekommen",
      sourceLanguage: "de",
      targetLanguage: "ar",
      entries: [{ term: "حصل على", partOfSpeech: "verb", meanings: ["N/A", "unknown"] }],
    });
    expect(onlyJunk).toBeNull();

    const junkTerm = parseLexicon({
      sourceTerm: "bekommen",
      sourceLanguage: "de",
      targetLanguage: "ar",
      entries: [{ term: "غير معروف", partOfSpeech: "verb", meanings: ["نال"] }],
    });
    expect(junkTerm).toBeNull();
  });

  it("clears a model translation that is not in the target language", () => {
    const parsed = parseLexicon({
      ...legacyPayload,
      translation: "bank account",
    });
    expect(parsed?.translation).toBe("");
    const junk = parseLexicon({ ...legacyPayload, translation: "N/A" });
    expect(junk?.translation).toBe("");
  });
});

describe("lexicon lemma and example quality", () => {
  it("normalizes the English citation marker and refuses a lemma in the wrong language", () => {
    const english = parseLexicon({
      sourceTerm: "be",
      sourceLanguage: "en",
      targetLanguage: "de",
      entries: [
        {
          term: "sein",
          lemma: "to be",
          partOfSpeech: "verb",
          meanings: ["sein"],
          examples: [{ text: "Ich bin müde.", translation: "I am tired." }],
        },
      ],
    });
    expect(english?.entries[0]?.lemma).toBe("be");

    // An Arabic source lemma must be Arabic; a German (wrong-script) lemma is dropped.
    const arabic = parseLexicon({
      sourceTerm: "بيت",
      sourceLanguage: "ar",
      targetLanguage: "de",
      entries: [
        {
          term: "Haus",
          lemma: "bank",
          partOfSpeech: "noun",
          meanings: ["Haus"],
          examples: [{ text: "Das Haus ist alt.", translation: "البيت قديم." }],
        },
      ],
    });
    expect(arabic?.entries[0]?.lemma).toBe("");
  });

  it("drops examples written in the source language and keeps target-language examples", () => {
    const parsed = parseLexicon({
      sourceTerm: "bekommen",
      sourceLanguage: "de",
      targetLanguage: "ar",
      entries: [
        {
          term: "حصل على",
          partOfSpeech: "verb",
          meanings: ["حصل على"],
          examples: [
            { text: "Ich habe einen Brief bekommen.", translation: "حصلت على رسالة." },
            { text: "حصلت على رسالة.", translation: "I received a letter." },
          ],
        },
      ],
    });
    expect(parsed?.entries[0]?.examples).toEqual([
      { text: "حصلت على رسالة.", translation: "I received a letter." },
    ]);
  });

  it("drops an example that is only the headword, deduplicates and clears an echoed translation", () => {
    const parsed = parseLexicon({
      sourceTerm: "bekommen",
      sourceLanguage: "de",
      targetLanguage: "ar",
      entries: [
        {
          term: "نال",
          partOfSpeech: "verb",
          meanings: ["نال"],
          examples: [
            { text: "نال", translation: "نال" },
            { text: "نال الجائزة.", translation: "نال الجائزة." },
            { text: "نال الجائزة.", translation: "He won the prize." },
          ],
        },
      ],
    });
    expect(parsed?.entries[0]?.examples).toEqual([{ text: "نال الجائزة.", translation: "" }]);
  });

  it("parses labelled form objects and drops punctuation-only placeholders", () => {
    const parsed = parseLexicon({
      sourceTerm: "Bank",
      sourceLanguage: "de",
      targetLanguage: "ar",
      entries: [
        {
          term: "بنك",
          partOfSpeech: "noun",
          meanings: ["مصرف"],
          forms: [
            { label: "Genus", value: "die" },
            { label: "Plural", value: "die Banken" },
            "—",
            "die Bank",
          ],
        },
      ],
    });
    expect(parsed?.entries[0]?.forms).toEqual(["Genus: die", "Plural: die Banken", "die Bank"]);
  });

  it("drops junk nuances but keeps short real ones", () => {
    const parsed = parseLexicon({
      sourceTerm: "bekommen",
      sourceLanguage: "de",
      targetLanguage: "ar",
      entries: [
        {
          term: "حصل على",
          partOfSpeech: "verb",
          meanings: ["حصل على"],
          nuances: [
            { kind: "near_synonym", text: "N/A" },
            { kind: "near_synonym", text: "—" },
            { kind: "shift", text: "غير مكافئ هنا." },
          ],
        },
      ],
    });
    expect(parsed?.entries[0]?.nuances).toEqual([{ kind: "shift", text: "غير مكافئ هنا." }]);
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
    // "بنك" is more frequent; then the in-context flag, then everyday frequency.
    expect(parsed?.entries[0]?.term).toBe("مقعد");
    expect(parsed?.entries[0]?.meanings[0]).toBe("مقعد الحديقة");
    expect(parsed?.entries[1]?.term).toBe("بنك");
  });

  it("recognises a contained headword and a contained reading", () => {
    const parsed = parseLexicon({
      sourceTerm: "bank",
      sourceLanguage: "en",
      targetLanguage: "ar",
      translation: "ضفة النهر",
      entries: [
        {
          term: "بنك",
          partOfSpeech: "noun",
          meanings: ["مصرف"],
          primary: true,
          frequency: 0.9,
        },
        {
          term: "ضفة",
          partOfSpeech: "noun",
          meanings: ["جانب", "ضفة النهر"],
          primary: false,
          frequency: 0.4,
        },
      ],
    });
    // "ضفة النهر" contains the headword "ضفة"; the contained reading is ranked first inside it.
    expect(parsed?.entries[0]?.term).toBe("ضفة");
    expect(parsed?.entries[0]?.meanings[0]).toBe("ضفة النهر");
  });

  it("rankMeanings is deterministic and leaves unmatched readings in model order", () => {
    expect(rankMeanings(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(rankMeanings(["a", "b", "c"], "b")).toEqual(rankMeanings(["a", "b", "c"], "b"));
    expect(rankMeanings(["a", "b", "c"], "zzz")).toEqual(["a", "b", "c"]);
    expect(rankMeanings([], "b")).toEqual([]);
    // Containment only reorders when it is a real word/phrase relation.
    expect(rankMeanings(["جانب", "ضفة"], "ضفة النهر")).toEqual(["ضفة", "جانب"]);
  });

  it("rankEntries falls back to primary then frequency when the translation matches nothing", () => {
    const entries = [
      { term: "A", meanings: ["a"], primary: false, frequency: 0.2 },
      { term: "B", meanings: ["b"], primary: true, frequency: 0.1 },
      { term: "C", meanings: ["c"], primary: false, frequency: 0.9 },
    ].map((entry) => ({
      term: entry.term,
      lemma: "",
      partOfSpeech: "noun" as const,
      meanings: entry.meanings,
      definition: "",
      example: "",
      exampleTranslation: "",
      primary: entry.primary,
      forms: [],
      synonyms: [],
      frequency: entry.frequency,
      register: "",
      variety: "",
      collocations: [],
      examples: [],
      nuances: [],
      pronunciation: "",
    }));
    expect(rankEntries(entries, "zzz").map((entry) => entry.term)).toEqual(["B", "C", "A"]);
  });
});

describe("lexicon request context echo", () => {
  const parsed = parseLexicon(legacyPayload)!;

  it("echoes the register and the Arabic variety, but only shows a context that adds information", () => {
    const echoed = applyLexiconRequestContext(parsed, {
      text: "Bank",
      source: "de",
      target: "ar",
      style: "formal",
      dialect: "levant",
      context: "Die Bank ist heute geschlossen.",
    });
    expect(echoed?.source).toBe("model");
    expect(echoed?.style).toBe("formal");
    expect(echoed?.dialect).toBe("levant");
    expect(echoed?.context).toBe("Die Bank ist heute geschlossen.");

    const sameAsTerm = applyLexiconRequestContext(parsed, {
      text: "Bank",
      source: "de",
      target: "ar",
      context: "  bank  ",
    });
    expect(sameAsTerm?.context).toBeUndefined();
  });

  it("never attaches an Arabic variety to a non-Arabic target", () => {
    const echoed = applyLexiconRequestContext(parsed, {
      text: "Bank",
      source: "de",
      target: "de",
      dialect: "levant",
    });
    expect(echoed?.dialect).toBeUndefined();
  });

  it("makes the request's term, direction and UI language authoritative", () => {
    // The model claimed en→ar, but the person asked de→ar for "Bank".
    const echoed = applyLexiconRequestContext(
      { ...parsed, sourceTerm: "bank", sourceLanguage: "en", targetLanguage: "ar" },
      { text: "Bank", source: "de", target: "ar" },
    );
    expect(echoed?.sourceTerm).toBe("Bank");
    expect(echoed?.sourceLanguage).toBe("de");
    expect(echoed?.targetLanguage).toBe("ar");
  });

  it("drops entries that only fit the model's claimed pair, returning null when nothing survives", () => {
    const latinEntries = {
      ...parsed,
      entries: [
        {
          ...parsed.entries[0]!,
          term: "bank",
          meanings: ["bank"],
        },
      ],
    };
    const echoed = applyLexiconRequestContext(latinEntries, {
      text: "Bank",
      source: "de",
      target: "ar",
    });
    expect(echoed).toBeNull();
  });

  it("re-checks the model translation against the authoritative target language", () => {
    const echoed = applyLexiconRequestContext(
      { ...parsed, translation: "bank" },
      { text: "Bank", source: "de", target: "ar" },
    );
    expect(echoed?.translation).toBe("");
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
    // Inflected/dialect/Arabizi resolution is the model's job, never a second request.
    expect(prompt).toContain("Resolve inflections");

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

  it("states the quality rules the parser enforces: lemma, language integrity, examples", () => {
    expect(LEXICON_SYSTEM).toContain("separable verb");
    expect(LEXICON_SYSTEM).toContain("Arabizi");
    expect(LEXICON_SYSTEM).toContain("Never analyze the source term as if it were the target word");
    expect(LEXICON_SYSTEM).toContain("TARGET-language sentences");
    expect(LEXICON_SYSTEM).toContain("near_synonym");
    expect(LEXICON_SYSTEM).toContain("governed preposition");
    expect(LEXICON_SYSTEM).toContain("never guess a lemma");
  });

  it("detects the source language when it is auto", () => {
    const prompt = lexiconUserPrompt({
      text: "Bank",
      source: "auto",
      target: "ar",
      uiLocale: "en",
    });
    expect(prompt).toContain("Source language: detect it");
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

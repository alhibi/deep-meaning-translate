import { describe, expect, it } from "vitest";
import { parseShadow } from "./shadow";

/**
 * "Ways to restore" is the only place the shadow proposes replacement text, so the
 * validator is a security boundary: a restore that changes a fact, a negation or the
 * script must never reach the person as an alternative. Every case below is adversarial:
 * the reply is well-formed and points at real words, so only the restore rule can reject
 * it.
 */
const restoreOutcome = (options: {
  source: string;
  translation: string;
  sourceQuote: string;
  targetQuote: string;
  restore: string;
}): "accepted" | "rejected" | "no-finding" => {
  const parsed = parseShadow(
    {
      losses: [
        {
          kind: "loss",
          category: "implied",
          severity: 2,
          confidence: 0.9,
          source_quote: options.sourceQuote,
          target_quote: options.targetQuote,
          explanation: "قد يضيع المعنى.",
          restores: [{ text: options.restore, note: "" }],
        },
      ],
    },
    options.source,
    options.translation,
  );
  if (!parsed) return "no-finding";
  const loss = parsed.losses[0];
  if (!loss) return "no-finding";
  return loss.restores.some((restore) => restore.text === options.restore)
    ? "accepted"
    : "rejected";
};

describe("restoration safety: facts", () => {
  it("rejects an alternative that invents a time the translation never had", () => {
    // The old validator only looked for facts *removed* from the alternative, so an
    // invented "um 8 Uhr" was offered as a restore.
    expect(
      restoreOutcome({
        source: "Wir treffen uns",
        translation: "Wir treffen uns",
        sourceQuote: "treffen",
        targetQuote: "uns",
        restore: "Wir treffen uns um 8 Uhr",
      }),
    ).toBe("rejected");
  });

  it("rejects an alternative that invents a date", () => {
    expect(
      restoreOutcome({
        source: "Wir treffen uns heute",
        translation: "Wir treffen uns heute",
        sourceQuote: "treffen",
        targetQuote: "heute",
        restore: "Wir treffen uns am 17.11.2026",
      }),
    ).toBe("rejected");
  });

  it("rejects an alternative that adds an emoji", () => {
    expect(
      restoreOutcome({
        source: "Ich komme morgen",
        translation: "Ich komme morgen",
        sourceQuote: "komme",
        targetQuote: "morgen",
        restore: "Ich komme morgen 😀",
      }),
    ).toBe("rejected");
  });

  it("keeps an alternative with exactly the same facts", () => {
    expect(
      restoreOutcome({
        source: "Wir treffen uns um 8 Uhr",
        translation: "Wir treffen uns um 8 Uhr",
        sourceQuote: "treffen",
        targetQuote: "treffen",
        restore: "Wir sehen uns um 8 Uhr",
      }),
    ).toBe("accepted");
  });

  it("rejects an alternative that drops an e-mail address", () => {
    // An e-mail is a fact like a number: the old check only knew http(s) links.
    expect(
      restoreOutcome({
        source: "Schreib an anna@example.de",
        translation: "Schreib an anna@example.de",
        sourceQuote: "Schreib",
        targetQuote: "Schreib",
        restore: "Sag an sie",
      }),
    ).toBe("rejected");
  });

  it("rejects an alternative that drops a link", () => {
    expect(
      restoreOutcome({
        source: "Mehr auf https://example.de/hilfe",
        translation: "Mehr auf https://example.de/hilfe",
        sourceQuote: "Mehr",
        targetQuote: "Mehr",
        restore: "Mehr auf der Seite",
      }),
    ).toBe("rejected");
  });

  it("rejects an alternative that drops a quoted name", () => {
    expect(
      restoreOutcome({
        source: 'Sag "Anna" Bescheid',
        translation: 'Sag "Anna" Bescheid',
        sourceQuote: "Sag",
        targetQuote: 'Sag "Anna"',
        restore: "Sag ihr Bescheid",
      }),
    ).toBe("rejected");
  });

  it("keeps an alternative that keeps the quoted name", () => {
    expect(
      restoreOutcome({
        source: 'Sag "Anna" Bescheid',
        translation: 'Sag "Anna" Bescheid',
        sourceQuote: "Sag",
        targetQuote: '"Anna"',
        restore: 'Sag bitte "Anna" Bescheid',
      }),
    ).toBe("accepted");
  });

  it("compares Arabic-Indic and Western digits as the same number", () => {
    expect(
      restoreOutcome({
        source: "Es waren drei schöne Tage",
        translation: "كانت 3 أيام جميلة",
        sourceQuote: "Es waren",
        targetQuote: "أيام",
        restore: "كانت ٣ أيام رائعة",
      }),
    ).toBe("accepted");
  });

  it("rejects a changed number even when both are Arabic-Indic", () => {
    expect(
      restoreOutcome({
        source: "Es waren drei schöne Tage",
        translation: "كانت ٣ أيام جميلة",
        sourceQuote: "Es waren",
        targetQuote: "أيام",
        restore: "كانت ٤ أيام رائعة",
      }),
    ).toBe("rejected");
  });
});

describe("restoration safety: negation", () => {
  it("rejects an alternative that drops a negation", () => {
    // Before this rule, "Ich kann kommen" was offered as a way to restore a sentence
    // that says the opposite ("Ich kann nicht kommen").
    expect(
      restoreOutcome({
        source: "أنا لا أستطيع الحضور",
        translation: "Ich kann nicht kommen",
        sourceQuote: "لا أستطيع",
        targetQuote: "nicht",
        restore: "Ich kann kommen",
      }),
    ).toBe("rejected");
  });

  it("accepts an alternative that keeps the negation while rephrasing", () => {
    expect(
      restoreOutcome({
        source: "أنا لا أستطيع الحضور",
        translation: "Ich kann nicht kommen",
        sourceQuote: "لا أستطيع",
        targetQuote: "nicht",
        restore: "Ich kann leider nicht kommen",
      }),
    ).toBe("accepted");
  });

  it("rejects an alternative that adds a second negation (flipped polarity)", () => {
    expect(
      restoreOutcome({
        source: "Ich komme morgen",
        translation: "Ich komme morgen",
        sourceQuote: "komme",
        targetQuote: "morgen",
        restore: "Ich komme morgen nicht",
      }),
    ).toBe("rejected");
  });

  it("treats Arabic negation cues the same way", () => {
    expect(
      restoreOutcome({
        source: "Ich komme nicht",
        translation: "أنا لا آتي",
        sourceQuote: "komme",
        targetQuote: "لا آتي",
        restore: "أنا آتي",
      }),
    ).toBe("rejected");
  });
});

describe("restoration safety: script and entities", () => {
  it("rejects an alternative that switches the writing system", () => {
    expect(
      restoreOutcome({
        source: "كانت أياماً جميلة",
        translation: "كانت أياماً جميلة",
        sourceQuote: "كانت",
        targetQuote: "أياماً",
        restore: "كانت good days",
      }),
    ).toBe("rejected");
  });

  it("rejects an alternative that introduces a foreign-script word", () => {
    // Neither "days" nor its script exists in the translation: this is not a restore.
    expect(
      restoreOutcome({
        source: "كانت أياماً جميلة",
        translation: "كانت أياماً جميلة",
        sourceQuote: "كانت",
        targetQuote: "أياماً",
        restore: "كانت days جميلة",
      }),
    ).toBe("rejected");
  });

  it("rejects an alternative that drops a brand the translation kept", () => {
    expect(
      restoreOutcome({
        source: "Wir treffen uns bei Starbucks",
        translation: "نلتقي في Starbucks في برلين",
        sourceQuote: "treffen",
        targetQuote: "Starbucks",
        restore: "نلتقي في مقهى في برلين",
      }),
    ).toBe("rejected");
  });

  it("keeps an Arabic alternative that keeps the brand verbatim", () => {
    expect(
      restoreOutcome({
        source: "Wir treffen uns bei Starbucks in Berlin",
        translation: "نلتقي في Starbucks في برلين",
        sourceQuote: "treffen",
        targetQuote: "برلين",
        restore: "نلتقي في Starbucks في ميونخ",
      }),
    ).toBe("accepted");
  });
});

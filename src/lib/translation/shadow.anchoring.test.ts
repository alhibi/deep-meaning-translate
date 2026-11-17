import { describe, expect, it } from "vitest";
import {
  anchor,
  anchorCandidates,
  anchorNearest,
  carryLosses,
  parseShadow,
  type Loss,
} from "./shadow";

/** Removes Arabic diacritics so a test can compare letters without the marks. */
const bareArabic = (value: string) =>
  value.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu, "");

const rawLoss = (o: Record<string, unknown>) => ({
  kind: "loss",
  category: "intensity",
  severity: 2,
  confidence: 0.9,
  explanation: "x",
  restores: [],
  ...o,
});

const makeLoss = (o: Partial<Loss> & { id: string }): Loss => ({
  kind: "loss",
  category: "intensity",
  severity: 2,
  confidence: 0.9,
  source: { start: 0, end: 0 },
  target: { start: 0, end: 0 },
  sourceQuote: "",
  targetQuote: "",
  explanation: "x",
  restores: [],
  ...o,
});

describe("anchoring repeated words", () => {
  const SOURCE = "Der Hund bellt laut. Der Hund schläft tief.";
  const TRANSLATION = "الكلب ينبح بصوت عالٍ. الكلب ينام بعمق.";

  it("maps each repeated quote to the occurrence its counterpart points at", () => {
    // Both findings quote the repeated "Der Hund" but name different target words.
    // Taking the first source occurrence for both pointed the second finding at the
    // first sentence — the old anchor() behaviour.
    const r = parseShadow(
      {
        losses: [
          rawLoss({ target_quote: "ينام", source_quote: "Der Hund" }),
          rawLoss({ target_quote: "ينبح", source_quote: "Der Hund", category: "warmth" }),
        ],
      },
      SOURCE,
      TRANSLATION,
    )!;
    expect(r.losses).toHaveLength(2);
    const sleeping = r.losses.find((loss) => loss.targetQuote === "ينام")!;
    const barking = r.losses.find((loss) => loss.targetQuote === "ينبح")!;
    expect(SOURCE.slice(barking.source.start, barking.source.end)).toBe("Der Hund");
    expect(barking.source.start).toBe(SOURCE.indexOf("Der Hund"));
    expect(SOURCE.slice(sleeping.source.start, sleeping.source.end)).toBe("Der Hund");
    expect(sleeping.source.start).toBe(SOURCE.lastIndexOf("Der Hund"));
  });

  it("honours an explicit occurrence when the model supplies one", () => {
    const source = "Der Hund bellt. Der Hund bellt.";
    const translation = "الكلب ينبح. الكلب ينبح.";
    const r = parseShadow(
      {
        losses: [
          rawLoss({
            source_quote: "Der Hund",
            target_quote: "الكلب",
            source_occurrence: 2,
            target_occurrence: 2,
          }),
        ],
      },
      source,
      translation,
    )!;
    expect(r.losses[0]!.source.start).toBe(source.lastIndexOf("Der Hund"));
    expect(r.losses[0]!.target.start).toBe(translation.lastIndexOf("الكلب"));
  });

  it("ignores an occurrence hint that is out of range", () => {
    const source = "Der Hund bellt. Der Hund bellt.";
    const translation = "الكلب ينبح. الكلب ينبح.";
    const r = parseShadow(
      {
        losses: [
          rawLoss({ source_quote: "Der Hund", target_quote: "الكلب", source_occurrence: 9 }),
        ],
      },
      source,
      translation,
    )!;
    expect(r.losses).toHaveLength(1);
    // Falls back to the relative position instead of crashing or dropping the finding.
    expect(r.losses[0]!.source.start).toBe(source.indexOf("Der Hund"));
  });

  it("returns every occurrence from anchorCandidates but the first from anchor", () => {
    expect(anchorCandidates("gut gut gut", "gut")).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
    expect(anchor("gut gut gut", "gut")).toEqual({ start: 0, end: 3 });
    expect(anchorNearest("gut gut gut", "gut", 9)).toEqual({ start: 8, end: 11 });
  });
});

describe("anchoring Arabic diacritics and tatweel", () => {
  it("anchors a bare quote inside a fully vocalised source", () => {
    const source = "يَا حَسْرَتَاهُ عَلَى الَّذِي فَاتَ";
    const span = anchor(source, "يا حسرتاه")!;
    expect(span.start).toBe(0);
    expect(bareArabic(source.slice(span.start, span.end))).toBe("يا حسرتاه");
  });

  it("anchors a vocalised quote inside a bare source", () => {
    const source = "يا حسرتاه على الذي فات";
    const span = anchor(source, "يَا حَسْرَتَاهُ")!;
    expect(source.slice(span.start, span.end)).toBe("يا حسرتاه");
  });

  it("folds tatweel so an elongated word still anchors", () => {
    const source = "مرحبـــــا بالجميع";
    const span = anchor(source, "مرحبا")!;
    expect(span.start).toBe(0);
    expect(source.slice(span.start, span.end).replace(/\u0640/gu, "")).toBe("مرحبا");
  });
});

describe("anchoring German letters", () => {
  it("treats decomposed and composed umlauts as the same letters", () => {
    const source = "Mu\u0308ller kommt spa\u0308ter";
    const span = anchor(source, "Müller")!;
    expect(source.slice(span.start, span.end).normalize("NFC")).toBe("Müller");
    // Case-insensitive too.
    expect(anchor(source, "MÜLLER")).toEqual(span);
  });

  it("matches ß without folding it into a different word", () => {
    const source = "Der Schluß ist gut";
    expect(anchor(source, "schluß")).toEqual({ start: 4, end: 10 });
    expect(anchor(source, "Schluss")).toBeNull();
  });
});

describe("anchoring punctuation and whitespace", () => {
  it("keeps a quote adjacent to punctuation anchored", () => {
    expect(anchor("Schade, dass es vorbei ist.", "Schade")).toEqual({ start: 0, end: 6 });
    expect(anchor("Schade, dass es vorbei ist.", "Schade,")).toEqual({ start: 0, end: 7 });
    expect(anchor("هل أنت بخير؟", "هل أنت بخير")).toEqual({ start: 0, end: 11 });
    expect(anchor("هل أنت بخير؟", "هل أنت بخير؟")).toEqual({ start: 0, end: 12 });
  });

  it("matches a quote whose inner punctuation differs from the text", () => {
    const span = anchor("Schade dass es vorbei ist", "Schade, dass")!;
    expect(span).toEqual({ start: 0, end: 11 });
  });

  it("folds newlines and tabs into single spaces", () => {
    const source = "Das ist\ngut\tgenug";
    const span = anchor(source, "ist gut genug")!;
    expect(source.slice(span.start, span.end)).toBe("ist\ngut\tgenug");
  });
});

describe("anchoring mixed-direction text", () => {
  it("anchors embedded Latin words without changing their offsets", () => {
    const source = "اشتريت iPhone 15 أمس";
    const device = anchor(source, "iPhone 15")!;
    expect(source.slice(device.start, device.end)).toBe("iPhone 15");
    const ends = anchor(source, "15 أمس")!;
    expect(source.slice(ends.start, ends.end)).toBe("15 أمس");
  });

  it("never anchors words that are not in the text", () => {
    expect(anchor("يا حسرتاه على اللي فات", "موجود")).toBeNull();
  });
});

describe("anchoring after a restore", () => {
  it("keeps a finding on the same repeated words when the translation changes", () => {
    const before = "Das war gut. Wirklich gut.";
    const after = "Das war sehr gut. Wirklich gut.";
    const previous: Loss[] = [
      makeLoss({
        id: "gut",
        targetQuote: "gut",
        target: { start: before.lastIndexOf("gut"), end: before.length },
      }),
    ];
    const kept = carryLosses(previous, after, "");
    expect(kept).toHaveLength(1);
    // The old anchor() would take the first "gut" and move the finding to the first
    // sentence; the edited sentence still has both occurrences.
    expect(kept[0]!.target.start).toBe(after.lastIndexOf("gut"));
  });
});

import { describe, expect, it } from "vitest";
import {
  planShadowAnalysis,
  planShadowWindows,
  sentenceSpans,
  SHADOW_MAX_PROMPT_CHARS,
  SHADOW_MAX_REQUESTS,
} from "./shadow";

const texts = (value: string) =>
  sentenceSpans(value).map((span) => value.slice(span.start, span.end));

/**
 * Sentence splitting feeds the window planner. The old splitter treated every period as a
 * sentence end, so a date, a time or an abbreviation could be cut in half and the two
 * halves could land in different analysis calls.
 */
describe("sentence boundaries", () => {
  it("does not split a date, a time or a decimal number", () => {
    expect(texts("Die Frist endet am 17.11.2026 um 9.30 Uhr.")).toEqual([
      "Die Frist endet am 17.11.2026 um 9.30 Uhr.",
    ]);
    expect(texts("Es kostet 3.5 Euro.")).toEqual(["Es kostet 3.5 Euro."]);
  });

  it("does not split an abbreviation from the word it introduces", () => {
    expect(texts("Das ist z. B. bei Dr. Müller so.")).toEqual(["Das ist z. B. bei Dr. Müller so."]);
    expect(texts("Wir treffen uns ca. 10 Minuten später.")).toEqual([
      "Wir treffen uns ca. 10 Minuten später.",
    ]);
  });

  it("still splits ordinary sentences and Arabic questions", () => {
    expect(texts("Das ist gut. Danach gehen wir.")).toEqual(["Das ist gut.", "Danach gehen wir."]);
    expect(texts("هل أنت بخير؟ نعم أنا بخير.")).toEqual(["هل أنت بخير؟", "نعم أنا بخير."]);
  });

  it("treats an ASCII ellipsis as one break, not three", () => {
    expect(texts("Warte... Danach geht es weiter.")).toEqual([
      "Warte...",
      "Danach geht es weiter.",
    ]);
  });

  it("keeps paragraph breaks as boundaries", () => {
    expect(texts("Erster Absatz.\n\nZweiter Absatz.")).toEqual([
      "Erster Absatz.",
      "Zweiter Absatz.",
    ]);
  });

  it("does not split the final sentence at the end of the text", () => {
    expect(texts("Nur ein Satz")).toEqual(["Nur ein Satz"]);
    expect(texts("Nur ein Satz.")).toEqual(["Nur ein Satz."]);
  });
});

/**
 * A window boundary must be a sentence boundary, and it must never fall inside a date, a
 * time, a number or an abbreviation — after the splitter fix, both are the same promise.
 */
describe("window boundaries", () => {
  const dated = Array.from(
    { length: 60 },
    (_value, index) =>
      `Am ${(index % 28) + 1}.${(index % 12) + 1}.2026 um ${index % 24}.${(index * 7) % 60} Uhr besprachen wir Punkt ${index + 1} der Tagesordnung.`,
  ).join(" ");

  it("cuts only at sentence starts and ends", () => {
    const source = dated;
    const sentences = sentenceSpans(source);
    const starts = new Set(sentences.map((span) => span.start));
    const ends = new Set(sentences.map((span) => span.end));
    const windows = planShadowWindows(source);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows.length).toBeLessThanOrEqual(SHADOW_MAX_REQUESTS);
    for (const window of windows) {
      expect(starts.has(window.start) || window.start === 0).toBe(true);
      expect(ends.has(window.end)).toBe(true);
    }
  });

  it("never puts a boundary between the parts of a date or a number", () => {
    const source = dated;
    for (const window of planShadowWindows(source)) {
      for (const boundary of [window.start, window.end]) {
        const before = source[boundary - 1] ?? "";
        const after = source[boundary] ?? "";
        // A split "3.5" / "17.11.2026" would leave a digit glued to a period or to a digit.
        expect(/\d/u.test(before) && /[.\d]/u.test(after)).toBe(false);
        expect(before === "." && /\d/u.test(after)).toBe(false);
      }
    }
  });

  it("covers every character exactly by ordered windows and keeps text slices exact", () => {
    const source = dated;
    const windows = planShadowWindows(source);
    for (const window of windows) expect(window.text).toBe(source.slice(window.start, window.end));
    for (let index = 0; index < source.length; index += 1) {
      expect(windows.some((window) => window.start <= index && index < window.end)).toBe(true);
    }
    expect(windows[0]!.start).toBe(0);
    expect(windows[windows.length - 1]!.end).toBe(source.length);
  });
});

describe("diacritics and normalized text", () => {
  it("keeps a decomposed umlaut inside its word at every window boundary", () => {
    // iCloud/Android keyboards and pastes can deliver "u" + combining diaeresis. A window
    // must never split that cluster, and a window's text must be an exact slice so the
    // offset arithmetic still lands on the right code units.
    const word = "Mu\u0308ller";
    const source = Array.from(
      { length: 80 },
      (_value, index) => `Am Montag traf ${word} den Kollegen Nummer ${index + 1} im Bu\u0308ro.`,
    ).join(" ");
    const windows = planShadowWindows(source);
    expect(windows.length).toBeGreaterThan(1);
    for (const window of windows) {
      expect(window.text).toBe(source.slice(window.start, window.end));
      // No boundary points at a combining mark or immediately after its base letter.
      expect(/\p{M}/u.test(source[window.start] ?? "")).toBe(false);
      expect(/\p{M}/u.test(source[window.end] ?? "")).toBe(false);
    }
  });

  it("leaves a short decomposed text as one exact window", () => {
    const source = "Mu\u0308ller kommmt spa\u0308ter, sagt er.";
    const windows = planShadowWindows(source);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.text).toBe(source);
  });
});

describe("bounded analysis plan", () => {
  const base = {
    source: "de",
    target: "ar",
    style: "natural",
    uiLocale: "en",
  };

  it("never exceeds the request cap, however long the text", () => {
    const source = Array.from(
      { length: 400 },
      (_value, index) => `Satz ${index + 1} ist lang genug, um wirklich zu zählen.`,
    )
      .join(" ")
      .slice(0, 4_999);
    const plan = planShadowAnalysis({ ...base, text: source, translation: source });
    expect(plan.requests).toBeGreaterThan(0);
    expect(plan.requests).toBeLessThanOrEqual(SHADOW_MAX_REQUESTS);
  });

  it("keeps the total prompt budget even when the translation is at its schema limit", () => {
    const source = Array.from(
      { length: 400 },
      (_value, index) => `Satz ${index + 1} ist lang genug, um wirklich zu zählen.`,
    )
      .join(" ")
      .slice(0, 4_999);
    const translation = "هذه ترجمة طويلة جداً ".repeat(1_000).slice(0, 15_000);
    const plan = planShadowAnalysis({ ...base, text: source, translation });
    expect(plan.promptChars).toBeLessThanOrEqual(SHADOW_MAX_PROMPT_CHARS);
    expect(plan.depthLimited).toBe(true);
  });
});

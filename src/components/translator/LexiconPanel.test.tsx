import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LexiconPanel } from "./LexiconPanel";
import type { LexicalEntry, LexiconResult } from "@/lib/translation/lexicon";

const entry = (
  term: string,
  index: number,
  overrides: Partial<LexicalEntry> = {},
): LexicalEntry => ({
  term,
  lemma: index === 0 ? "charming" : "",
  partOfSpeech: "adjective",
  meanings: [`معنى ${index + 1}`, `قراءة ${index + 1}`],
  definition: `تعريف ${index + 1}`,
  example: `example ${index + 1}`,
  exampleTranslation: `مثال ${index + 1}`,
  primary: index === 0,
  forms: [],
  synonyms: [],
  frequency: 0.5,
  register: "",
  variety: "",
  collocations: [],
  examples: [{ text: `example ${index + 1}`, translation: `مثال ${index + 1}` }],
  nuances: [],
  pronunciation: "",
  ...overrides,
});

const value: LexiconResult = {
  source: "model",
  sourceTerm: "charming",
  sourceLanguage: "en",
  targetLanguage: "ar",
  translation: "",
  entries: ["ساحر", "جذّاب", "فاتن", "آسر"].map((term, index) => entry(term, index)),
};

describe("LexiconPanel", () => {
  it("shows three quiet entries, then expands all meanings and examples", () => {
    render(<LexiconPanel value={value} loading={false} />);
    expect(screen.getByText("ساحر")).toBeTruthy();
    expect(screen.queryByText("آسر")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText("آسر")).toBeTruthy();
    // Details stay collapsed per entry; opening the fourth one reveals its example pair.
    const details = screen.getByRole("button", { name: "آسر — Forms, examples & nuance" });
    expect(details.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(details);
    expect(details.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("مثال 4")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("shows the model translation, forms, synonyms and the model-source label", () => {
    const v: LexiconResult = {
      ...value,
      translation: "ساحر",
      entries: [
        entry("ساحر", 0, {
          forms: ["Genus: der · Plural: die Zauberer"],
          synonyms: ["خلّاب"],
          collocations: ["auf etwas warten"],
          nuances: [{ kind: "false_friend", text: 'ليست "charmant" بالضرورة.' }],
          pronunciation: "ˈʃaːʁmənt",
          register: "neutral",
          variety: "MSA",
        }),
      ],
    };
    render(<LexiconPanel value={v} loading={false} />);
    expect(screen.getByText("Model reading — not a verified dictionary")).toBeTruthy();
    expect(screen.getByText("Model translation")).toBeTruthy();
    expect(screen.getByText("In this sentence")).toBeTruthy();
    expect(screen.queryByText("Genus: der · Plural: die Zauberer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ساحر — Forms, examples & nuance" }));
    expect(screen.getByText("Genus: der · Plural: die Zauberer")).toBeTruthy();
    expect(screen.getByText("خلّاب")).toBeTruthy();
    expect(screen.getByText("auf etwas warten")).toBeTruthy();
    expect(screen.getByText("Nuance")).toBeTruthy();
    expect(screen.getByText("False friend")).toBeTruthy();
    expect(screen.getByText("ˈʃaːʁmənt")).toBeTruthy();
    expect(screen.getByText("MSA")).toBeTruthy();
  });

  it("does not show an empty shell: a null reading is a quiet empty state", () => {
    render(<LexiconPanel value={null} loading={false} />);
    expect(screen.getByText("No dictionary reading for this term.")).toBeTruthy();
  });

  it("shows a quiet loading status instead of a skeleton", () => {
    render(<LexiconPanel value={null} loading={true} />);
    expect(screen.getByRole("status").textContent).toContain("Finding precise meanings…");
  });

  it("marks Arabic headwords as RTL with the Arabic face", () => {
    render(<LexiconPanel value={value} loading={false} />);
    const terms = screen.getAllByText("ساحر");
    const headword = terms.find((node) => node.getAttribute("lang") === "ar");
    expect(headword?.getAttribute("dir")).toBe("rtl");
    expect(headword?.className).toContain("font-arabic");
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(3);
  });
});

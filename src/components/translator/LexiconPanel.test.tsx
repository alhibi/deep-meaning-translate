import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
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

afterEach(() => {
  // The locale is module state; a test that switches it must not leak into the next one.
  setLocale("en", false);
});

describe("LexiconPanel loading and failure states", () => {
  it("says the dictionary is unavailable, not that the term has no reading", () => {
    render(<LexiconPanel value={null} loading={false} failed />);
    const failure = screen.getByTestId("lexicon-failure");
    expect(failure.textContent).toBe(
      "The dictionary didn't answer this time. Your translation is unaffected.",
    );
    expect(failure.getAttribute("role")).toBe("status");
    expect(screen.queryByText("No dictionary reading for this term.")).toBeNull();
  });

  it("keeps the empty reading distinct from a failure", () => {
    render(<LexiconPanel value={null} loading={false} />);
    expect(screen.getByText("No dictionary reading for this term.")).toBeTruthy();
    expect(screen.queryByTestId("lexicon-failure")).toBeNull();
  });

  it("localizes the failure without an i18n.ts key", () => {
    setLocale("ar", false);
    const arabic = render(<LexiconPanel value={null} loading={false} failed />);
    expect(screen.getByTestId("lexicon-failure").textContent).toBe(
      "لم يُجب المعجم هذه المرة. ترجمتك لم تتأثر.",
    );
    arabic.unmount();
    setLocale("de", false);
    render(<LexiconPanel value={null} loading={false} failed />);
    expect(screen.getByTestId("lexicon-failure").textContent).toBe(
      "Das Wörterbuch hat diesmal nicht geantwortet. Deine Übersetzung ist davon unberührt.",
    );
  });
});

describe("LexiconPanel direction", () => {
  const german: LexiconResult = {
    source: "model",
    sourceTerm: "بنك",
    sourceLanguage: "ar",
    targetLanguage: "de",
    translation: "Bank",
    context: "البيت قديم.",
    entries: [
      entry("Bank", 0, {
        meanings: ["Bank", "Geldinstitut"],
        definition: "Ein Geldinstitut.",
        synonyms: ["Kreditinstitut", "Geldhaus"],
      }),
    ],
  };

  it("follows the interface direction for layout and the target direction for its words", () => {
    setLocale("ar", false);
    render(<LexiconPanel value={german} loading={false} />);
    // The row (bullet, indentation, labels) belongs to the Arabic interface: RTL, while the
    // German headword and readings stay LTR — a language's script, not the interface's.
    expect(screen.getByTestId("lexicon-entry").getAttribute("dir")).toBe("rtl");
    const headword = screen.getAllByText("Bank").find((node) => node.getAttribute("lang") === "de");
    expect(headword?.getAttribute("dir")).toBe("ltr");
    expect(headword?.className ?? "").not.toContain("font-arabic");
    // The source sentence keeps its own direction too.
    const context = screen.getByText("البيت قديم.");
    expect(context.getAttribute("lang")).toBe("ar");
    expect(context.getAttribute("dir")).toBe("rtl");
    expect(context.className).toContain("font-arabic");

    fireEvent.click(screen.getByRole("button", { name: /Bank — / }));
    // Target-language synonyms are joined with the target language's punctuation.
    expect(screen.getByText("Kreditinstitut · Geldhaus")).toBeTruthy();
  });

  it("keeps an Arabic target row readable in an English interface", () => {
    setLocale("en", false);
    render(<LexiconPanel value={value} loading={false} />);
    expect(screen.getAllByTestId("lexicon-entry")[0]?.getAttribute("dir")).toBe("ltr");
    const headword = screen.getAllByText("ساحر").find((node) => node.getAttribute("lang") === "ar");
    expect(headword?.getAttribute("dir")).toBe("rtl");
  });

  it("marks a refreshing panel busy without replacing the visible reading", () => {
    render(<LexiconPanel value={value} loading={true} />);
    expect(screen.getByRole("region", { name: "Meanings" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Finding precise meanings…")).toBeNull();
  });
});

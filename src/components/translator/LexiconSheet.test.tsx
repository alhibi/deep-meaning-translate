import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { LexiconResult } from "@/lib/translation/lexicon";

const lookup = vi.fn();
vi.mock("@/lib/native/rpc", () => ({ callLexicon: (...args: unknown[]) => lookup(...args) }));
const { useLexicon } = await import("@/lib/translation/useLexicon");
const { resetEnrichmentQueueForTests } = await import("@/lib/translation/enrichment");
const { LexiconSheet } = await import("./LexiconSheet");

const entry = (term: string) => ({
  term,
  lemma: "",
  partOfSpeech: "noun" as const,
  meanings: ["ضفة النهر"],
  definition: "",
  example: "",
  exampleTranslation: "",
  primary: true,
  forms: [] as string[],
  synonyms: [] as string[],
  frequency: 0.5,
  register: "",
  variety: "",
  collocations: [] as string[],
  examples: [] as { text: string; translation: string }[],
  nuances: [] as { kind: "shift"; text: string }[],
  pronunciation: "",
});

const value = (sourceTerm: string, overrides: Partial<LexiconResult> = {}): LexiconResult => ({
  source: "model",
  sourceTerm,
  sourceLanguage: "en",
  targetLanguage: "ar",
  translation: "",
  entries: [entry("ضفة")],
  ...overrides,
});

const close = () => {};

function Harness({ text, dialect }: { text: string; dialect?: "levant" }) {
  const { lexicon, loading } = useLexicon({
    text,
    source: "en",
    target: "ar",
    uiLocale: "en",
    settled: true,
    translation: text === "bank" ? "ضفة" : undefined,
    ...(dialect ? { dialect } : {}),
  });
  return <LexiconSheet open value={lexicon} loading={loading} onClose={close} />;
}

const flush = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers();
  lookup.mockReset();
  resetEnrichmentQueueForTests(0, 250);
});
afterEach(() => {
  resetEnrichmentQueueForTests(0);
  vi.useRealTimers();
});

describe("LexiconSheet", () => {
  it("shows the identity of the lookup: term, direction and Arabic variety", async () => {
    lookup.mockResolvedValue({
      ok: true,
      lexicon: value("bank", {
        translation: "ضفة",
        dialect: "levant",
        context: "He sat on the bank of the river.",
      }),
    });
    render(<Harness text="bank" dialect="levant" />);
    await flush(400);
    const dialog = screen.getByRole("dialog", { name: "Dictionary" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // The reading is explicitly labelled model-generated, never a verified dictionary.
    expect(screen.getByText("Model reading — not a verified dictionary")).toBeTruthy();
    expect(screen.getByText("English")).toBeTruthy();
    expect(screen.getByText("العربية")).toBeTruthy();
    expect(screen.getByText(/Levantine/)).toBeTruthy();
    // The pair stays readable left-to-right: source, arrow, target.
    expect(screen.getByTestId("lexicon-direction").getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("From this sentence")).toBeTruthy();
    expect(screen.getByText("He sat on the bank of the river.")).toBeTruthy();
    const term = screen.getByText("bank");
    expect(term.getAttribute("lang")).toBe("en");
  });

  it("is a quiet status while loading, not a blank dialog", async () => {
    lookup.mockImplementation(() => new Promise(() => {}));
    render(<Harness text="sorcerer" />);
    await flush(300);
    expect(screen.getByRole("status").textContent).toContain("Finding precise meanings…");
    expect(screen.getByRole("dialog", { name: "Dictionary" })).toBeTruthy();
  });

  it("turns a failed lookup into an empty state, never an error surface", async () => {
    lookup.mockRejectedValue(new Error("provider down"));
    render(<Harness text="sorcerer" />);
    await flush(400);
    expect(screen.getByText("No dictionary reading for this term.")).toBeTruthy();
  });

  it("never lets an older lookup replace a newer term's reading", async () => {
    let finishOld: (response: unknown) => void = () => {};
    lookup.mockImplementation(({ data }: { data: { text: string } }) => {
      if (data.text === "sorcerer") {
        return new Promise((resolve) => {
          finishOld = resolve;
        });
      }
      return Promise.resolve({ ok: true, lexicon: value("wizard") });
    });
    const { rerender } = render(<Harness text="sorcerer" />);
    await flush(300); // the first (slow) lookup is now in flight
    rerender(<Harness text="wizard" />);
    await flush(400);
    expect(screen.getByText("wizard")).toBeTruthy();
    await act(async () => {
      finishOld({ ok: true, lexicon: value("sorcerer") });
      await Promise.resolve();
    });
    await flush(20);
    expect(screen.getByText("wizard")).toBeTruthy();
    expect(screen.queryByText("sorcerer")).toBeNull();
  });

  it("clears a reading as soon as the draft stops being a term", async () => {
    lookup.mockResolvedValue({ ok: true, lexicon: value("sorcerer") });
    const { rerender } = render(<Harness text="sorcerer" />);
    await flush(400);
    expect(screen.getByText("sorcerer")).toBeTruthy();
    rerender(<Harness text="Can you help me tomorrow?" />);
    await flush(400);
    expect(screen.queryByText("sorcerer")).toBeNull();
    expect(screen.getByText("No dictionary reading for this term.")).toBeTruthy();
  });
});

afterEach(() => {
  // The locale is module state; a test that switches it must not leak into the next one.
  setLocale("en", false);
});

describe("LexiconSheet states and direction", () => {
  it("says the dictionary is unavailable, not that the term has no reading", () => {
    render(<LexiconSheet open value={null} loading={false} failed onClose={close} />);
    expect(screen.getByRole("dialog", { name: "Dictionary" })).toBeTruthy();
    expect(screen.getByTestId("lexicon-failure").textContent).toContain("didn't answer");
    expect(screen.queryByText("No dictionary reading for this term.")).toBeNull();
  });

  it("keeps the dialog in the interface direction and the pair left-to-right", () => {
    setLocale("ar", false);
    render(<LexiconSheet open value={value("bank")} loading={false} onClose={close} />);
    const dialog = screen.getByRole("dialog", { name: "المعجم" });
    expect(dialog.getAttribute("dir")).toBe("rtl");
    // A language pair is directional, not prose: English → Arabic stays left-to-right.
    expect(screen.getByTestId("lexicon-direction").getAttribute("dir")).toBe("ltr");
    const term = screen.getByText("bank");
    expect(term.getAttribute("lang")).toBe("en");
    expect(term.getAttribute("dir")).toBe("ltr");
  });

  it("keeps the loading status inside the open dialog, as a status not a blank surface", () => {
    render(<LexiconSheet open value={null} loading onClose={close} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Finding precise meanings…");
  });
});

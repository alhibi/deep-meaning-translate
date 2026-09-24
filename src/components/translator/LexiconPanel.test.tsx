import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LexiconPanel } from "./LexiconPanel";

const value = {
  sourceTerm: "charming",
  sourceLanguage: "en",
  targetLanguage: "ar",
  entries: ["ساحر", "جذّاب", "فاتن", "آسر"].map((term, index) => ({
    term,
    partOfSpeech: "adjective" as const,
    meanings: [`معنى ${index + 1}`],
    definition: `تعريف ${index + 1}`,
    example: `example ${index + 1}`,
    exampleTranslation: `مثال ${index + 1}`,
    primary: index === 0,
  })),
};

describe("LexiconPanel", () => {
  it("shows three quiet entries, then expands all meanings and examples", () => {
    render(<LexiconPanel value={value} loading={false} />);
    expect(screen.getByText("ساحر")).toBeTruthy();
    expect(screen.queryByText("آسر")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText("آسر")).toBeTruthy();
    expect(screen.getByText("مثال 4")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
  });
});

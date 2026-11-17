import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DictationText } from "./DictationText";

describe("dictation echo", () => {
  it("preserves the draft's paragraphs, tabs and spaces exactly", () => {
    const base = "  مرحباً 🙂\n\n  Hallo\tWelt  ";
    const { container } = render(
      <DictationText text={base + "كلام جديد"} baseLength={base.length} />,
    );
    expect(container.textContent).toBe(base + "كلام جديد");
    expect([...container.querySelectorAll(".speech-word")].map((e) => e.textContent)).toEqual([
      "كلام",
      "جديد",
    ]);
  });

  it("does not animate pre-existing text or whitespace when dictation starts", () => {
    const text = "Existing\n\nparagraphs  ";
    const { container } = render(<DictationText text={text} baseLength={text.length} />);
    expect(container.querySelector(".speech-word")).toBeNull();
  });
});

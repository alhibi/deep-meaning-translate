import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageBar } from "./LanguageBar";

vi.mock("./LanguageSheet", () => ({
  LanguageSheet: () => null,
  readRecent: () => [],
  pushRecent: vi.fn(),
}));

describe("quiet language swap", () => {
  it("keeps an accessible touch target without a background, border or shadow", () => {
    const swap = vi.fn();
    render(
      <LanguageBar source="ar" target="de" onSource={() => {}} onTarget={() => {}} onSwap={swap} />,
    );
    const button = screen.getByRole("button", { name: "Swap languages" });
    expect(button).toHaveClass("bg-transparent", "size-11");
    expect(button.className).not.toMatch(/(?:^|\s)(?:border(?:-|\s)|shadow(?:-|\s)|bg-card)/);
    fireEvent.click(button);
    expect(swap).toHaveBeenCalledTimes(1);
  });
});

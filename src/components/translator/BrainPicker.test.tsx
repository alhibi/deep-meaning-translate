import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { BrainPicker } from "./BrainPicker";

afterEach(() => {
  localStorage.clear();
  setLocale("en", false);
});

describe("BrainPicker", () => {
  it("offers Luna as a real selectable model, not a coming-soon placeholder", () => {
    setLocale("en", false);
    const onChange = vi.fn();
    render(<BrainPicker value="deepseek" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Translation model: DeepSeek" }));
    const dialog = screen.getByRole("dialog", { name: "Translation model" });
    expect(within(dialog).queryByText("Soon")).toBeNull();

    const luna = within(dialog).getByRole("button", { name: /Luna/ });
    expect(luna).toHaveTextContent("Expressive and natural");
    fireEvent.click(luna);
    expect(onChange).toHaveBeenCalledWith("luna");
  });
});

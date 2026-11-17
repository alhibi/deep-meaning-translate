import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { BrainPicker } from "./BrainPicker";

afterEach(() => {
  localStorage.clear();
  setLocale("en", false);
});

describe("BrainPicker", () => {
  it("offers Sona as a real selectable model under the new identity", () => {
    setLocale("en", false);
    const onChange = vi.fn();
    render(<BrainPicker value="deepseek" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Translation model: Velo" }));
    const dialog = screen.getByRole("dialog", { name: "Translation model" });
    expect(within(dialog).queryByText("Soon")).toBeNull();
    // Models are not languages: the shared picker must not print the language heading.
    expect(within(dialog).queryByText("All languages")).toBeNull();
    expect(within(dialog).queryByText(/DeepSeek|Luna/)).toBeNull();

    const sona = within(dialog).getByRole("button", { name: /Sona/ });
    expect(sona).toHaveTextContent("Natural, smooth, expressive");
    fireEvent.click(sona);
    expect(onChange).toHaveBeenCalledWith("luna");
  });

  it("maps the product names onto the existing brain ids", () => {
    setLocale("en", false);
    const onChange = vi.fn();
    const first = render(<BrainPicker value="luna" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Translation model: Sona" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Translation model" })).getByRole("button", {
        name: /Velo/,
      }),
    );
    expect(onChange).toHaveBeenCalledWith("deepseek");

    first.unmount();
    onChange.mockClear();
    render(<BrainPicker value="deepseek" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Translation model: Velo" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Translation model" })).getByRole("button", {
        name: /Sona/,
      }),
    );
    expect(onChange).toHaveBeenCalledWith("luna");
  });

  it("uses the Arabic identity copy and descriptions", () => {
    setLocale("ar", false);
    const onChange = vi.fn();
    render(<BrainPicker value="deepseek" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "نموذج الترجمة: Velo" }));
    const dialog = screen.getByRole("dialog", { name: "نموذج الترجمة" });

    const velo = within(dialog).getByRole("button", { name: /Velo/ });
    expect(velo).toHaveTextContent("سريع، دقيق، عملي");
    const sona = within(dialog).getByRole("button", { name: /Sona/ });
    expect(sona).toHaveTextContent("طبيعي، سلس، معبّر");
  });
});

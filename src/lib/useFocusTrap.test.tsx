import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useFocusTrap } from "./useFocusTrap";

/** A dialog like the app's sheets: a close button, a field, and a list of choices. */
function Sheet({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref);
  if (!open) return <button type="button">outside</button>;
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="sheet">
      <button type="button">close</button>
      <input aria-label="search" />
      <button type="button">last</button>
    </div>
  );
}

const tab = (shiftKey = false) =>
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true }),
    );
  });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("dialog focus", () => {
  it("moves focus into the sheet and returns it to the opener", async () => {
    const opener = document.createElement("button");
    opener.textContent = "open";
    document.body.append(opener);
    opener.focus();

    const { rerender } = render(<Sheet open={false} />);
    await act(async () => {
      rerender(<Sheet open />);
    });

    expect(document.activeElement?.textContent).toBe("close");

    rerender(<Sheet open={false} />);
    expect(document.activeElement).toBe(opener);
  });

  it("keeps Tab inside the sheet: last → first, and Shift+Tab first → last", async () => {
    const { rerender } = render(<Sheet open={false} />);
    await act(async () => {
      rerender(<Sheet open />);
    });

    const [close, last] = screen.getAllByRole("button") as [HTMLElement, HTMLElement];
    last.focus();
    tab();
    expect(document.activeElement).toBe(close);

    tab(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "last" }));
  });

  it("pulls focus back when it has escaped to the page behind the dialog", async () => {
    const { rerender } = render(<Sheet open={false} />);
    await act(async () => {
      rerender(<Sheet open />);
    });

    const behind = document.createElement("button");
    document.body.append(behind);
    behind.focus();
    tab();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });
});

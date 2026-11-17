import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShadowMap, ShadowSheet } from "./ShadowSheet";
import type { Loss } from "@/lib/translation/shadow";

const SOURCE = "يا حسرتاه على اللي فات";
const TRANSLATION = "Schade, dass es vorbei ist";

const loss = (o: Partial<Loss> = {}): Loss => ({
  id: "loss-1",
  kind: "loss",
  category: "intensity",
  severity: 2,
  confidence: 0.8,
  source: { start: 0, end: 9 },
  target: { start: 0, end: 6 },
  sourceQuote: "يا حسرتاه",
  targetQuote: "Schade",
  explanation: "Some regret may be lost.",
  restores: [
    {
      text: "Ach, wie bitter, dass es vorbei ist",
      note: "More regret",
      changed: { start: 0, end: 17 },
    },
  ],
  ...o,
});

const renderMap = (overrides: Partial<Loss>[] = [{}]) => {
  const losses = overrides.map((entry, index) => loss({ id: `loss-${index + 1}`, ...entry }));
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <ShadowMap
      open
      losses={losses}
      sourceText={SOURCE}
      sourceLang="ar"
      translation={TRANSLATION}
      targetLang="de"
      onPick={onPick}
      onClose={onClose}
    />,
  );
  return { losses, onPick, onClose };
};

describe("ShadowMap", () => {
  it("shows both texts in full with linked, numbered marks", () => {
    renderMap();
    expect(screen.getByRole("heading", { name: "Original" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Translation" })).toBeTruthy();
    const map = screen.getByTestId("shadow-map");
    // The whole source and the whole translation, not only the quoted fragment.
    expect(map.textContent).toContain("على اللي فات");
    expect(map.textContent).toContain("dass es vorbei ist");
    const sourceMark = map.querySelector('[data-side="source"]')!;
    const targetMark = map.querySelector('[data-side="target"]')!;
    expect(sourceMark.textContent).toContain("يا حسرتاه");
    expect(targetMark.textContent).toContain("Schade");
    expect(sourceMark.getAttribute("aria-label")).toMatch(/Meaning lost 1/);
    expect(sourceMark.getAttribute("aria-label")).toMatch(/Strength 2\/3/);
    expect(sourceMark.getAttribute("aria-label")).toMatch(/Confidence likely/);
    expect(sourceMark.getAttribute("aria-controls")).toBe("shadow-map-target-1");
  });

  it("clicking a span highlights its counterpart and clicking again clears it", () => {
    renderMap();
    const map = screen.getByTestId("shadow-map");
    const sourceMark = map.querySelector('[data-side="source"]') as HTMLElement;
    const targetMark = map.querySelector('[data-side="target"]') as HTMLElement;
    fireEvent.click(sourceMark);
    expect(targetMark.getAttribute("data-active")).toBe("true");
    expect(targetMark.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(sourceMark);
    expect(targetMark.getAttribute("data-active")).toBeNull();
    expect(targetMark.getAttribute("aria-pressed")).toBe("false");
    // The other direction is symmetric.
    fireEvent.click(targetMark);
    expect(sourceMark.getAttribute("data-active")).toBe("true");
  });

  it("shows severity and confidence as separate measures, never one value", () => {
    renderMap();
    expect(screen.getByText(/Strength 2\/3/)).toBeTruthy();
    expect(screen.getByText(/Confidence likely/)).toBeTruthy();
  });

  it("opens the matching finding when a row is chosen", () => {
    const { onPick } = renderMap();
    fireEvent.click(screen.getByText("Some regret may be lost."));
    expect(onPick).toHaveBeenCalledWith("loss-1");
  });

  it("renders calmly when a cached payload predates the kind field", () => {
    renderMap([{ kind: undefined as unknown as Loss["kind"] }]);
    const map = screen.getByTestId("shadow-map");
    expect(map.querySelector('[data-side="source"]')).toBeTruthy();
    // No crash and no invented kind label.
    expect(map.textContent).not.toContain("Meaning lost");
  });
});

describe("ShadowSheet detail", () => {
  const renderDetail = (entry: Loss) => {
    const onApply = vi.fn();
    const onKeep = vi.fn();
    const onClose = vi.fn();
    render(
      <ShadowSheet
        loss={entry}
        sourceText={SOURCE}
        sourceLang="ar"
        translation={TRANSLATION}
        targetLang="de"
        onApply={onApply}
        onKeep={onKeep}
        onClose={onClose}
      />,
    );
    return { onApply, onKeep, onClose };
  };

  it("shows both texts, the judgement, and a diff preview before Apply", () => {
    renderDetail(loss());
    expect(screen.getByTestId("shadow-sheet")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Original" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Translation" })).toBeTruthy();
    expect(screen.getByText("Meaning lost")).toBeTruthy();
    expect(screen.getByText("What changes")).toBeTruthy();
    // What disappears from the current translation…
    expect(document.querySelector("del")?.textContent).toBe("Schade,");
    // …and what the alternative puts there.
    expect(document.querySelector(".shadow-change")?.textContent).toBe("Ach, wie bitter,");
    expect(screen.getByText(/More regret/)).toBeTruthy();
  });

  it("offers Apply with the alternative and hands the choice back", () => {
    const { onApply, onKeep } = renderDetail(loss());
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: "loss-1" }), 0);
    fireEvent.click(screen.getByRole("button", { name: "Keep as is" }));
    expect(onKeep).toHaveBeenCalledWith(expect.objectContaining({ id: "loss-1" }));
  });

  it("says so quietly when no safe alternative exists", () => {
    renderDetail(loss({ restores: [] }));
    expect(screen.getByText("No safe alternative without losing something else.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Apply/ })).toBeNull();
  });

  it("closes on Escape", () => {
    const { onClose } = renderDetail(loss());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

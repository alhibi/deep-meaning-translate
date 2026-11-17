import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShadowHits, ShadowInk, ShadowSummary } from "./SentenceShadow";
import type { Loss } from "@/lib/translation/shadow";

const TEXT = "Schade, dass es vorbei ist";
const loss = (o: Partial<Loss> = {}): Loss => ({
  id: "loss-1",
  kind: "loss",
  category: "intensity",
  severity: 3,
  confidence: 0.9,
  source: { start: 0, end: 9 },
  target: { start: 0, end: 6 },
  sourceQuote: "يا حسرتاه",
  targetQuote: "Schade",
  explanation: "x",
  restores: [],
  ...o,
});

describe("ShadowInk", () => {
  it("paints only the shadowed fragment and keeps the text whole", () => {
    render(
      <ShadowInk text={TEXT} losses={[loss()]} focusId={null} className="" rtl={false} lang="de" />,
    );
    const ink = screen.getByTestId("shadow-ink");
    expect(ink.textContent).toBe(TEXT);
    const spot = ink.querySelector(".shadow-spot")!;
    expect(spot.textContent).toBe("Schade");
    expect(spot.getAttribute("data-loss-id")).toBe("loss-1");
  });
});

describe("ShadowHits", () => {
  it("makes the lost words touchable with a spoken description of the finding", () => {
    const onPick = vi.fn();
    render(
      <ShadowHits
        text={TEXT}
        losses={[loss()]}
        focusId={null}
        className=""
        rtl={false}
        lang="de"
        onPick={onPick}
      />,
    );
    const hit = screen.getByRole("button", { name: /Sentence shadow/ });
    expect(hit.getAttribute("aria-label")).toMatch(/Meaning lost/);
    expect(hit.getAttribute("aria-label")).toMatch(/Strength 3\/3/);
    expect(hit.getAttribute("aria-label")).toMatch(/Confidence likely/);
    fireEvent.click(hit);
    expect(onPick).toHaveBeenCalledWith("loss-1");
  });

  it("ignores a cached finding without a kind field", () => {
    render(
      <ShadowHits
        text={TEXT}
        losses={[loss({ kind: undefined as unknown as Loss["kind"] })]}
        focusId={null}
        className=""
        rtl={false}
        lang="de"
        onPick={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Sentence shadow/ })).toBeTruthy();
  });
});

describe("ShadowSummary", () => {
  it("says calmly and clearly when nothing was lost", () => {
    render(
      <ShadowSummary status="ready" losses={[]} onPick={() => {}} onMap={() => {}} undo={null} />,
    );
    expect(screen.getByText("Nothing essential lost")).toBeTruthy();
  });

  it("shows a reading state while the shadow is being judged", () => {
    render(
      <ShadowSummary status="loading" losses={[]} onPick={() => {}} onMap={() => {}} undo={null} />,
    );
    expect(screen.getByText("Reading the shadow…")).toBeTruthy();
  });

  it("lists the categories and opens a finding", () => {
    const onPick = vi.fn();
    render(
      <ShadowSummary
        status="ready"
        losses={[loss()]}
        onPick={onPick}
        onMap={() => {}}
        undo={null}
      />,
    );
    expect(screen.getByText("Lost: 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Intensity" }));
    expect(onPick).toHaveBeenCalledWith("loss-1");
  });

  it("confirms an applied fix and offers undo", () => {
    const onUndo = vi.fn();
    render(
      <ShadowSummary
        status="ready"
        losses={[loss()]}
        onPick={() => {}}
        onMap={() => {}}
        undo={{ onUndo }}
      />,
    );
    expect(screen.getByText("Applied")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalled();
  });
});

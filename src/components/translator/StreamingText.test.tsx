import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StreamingText } from "./StreamingText";

describe("StreamingText", () => {
  it("keeps settled words still and animates only the new tail", () => {
    const { container, rerender } = render(<StreamingText text="مرحبا بك" live />);
    expect(container.querySelectorAll(".word-in")).toHaveLength(2);
    expect(container.querySelector(".stream-caret")).not.toBeNull();

    rerender(<StreamingText text="مرحبا بك في البيت" live />);
    const animated = [...container.querySelectorAll(".word-in")].map((node) => node.textContent);
    // The two words that were already whirling keep their class; the new tail joins them.
    expect(animated.slice(-2)).toEqual(["في", "البيت"]);
    expect(animated).toContain("مرحبا");
    expect(container.querySelector(".stream-caret")).not.toBeNull();
  });

  it("never animates whitespace or a settled answer, and hides the caret", () => {
    const { container } = render(<StreamingText text="Hallo, wie geht es dir?" />);
    expect(container.querySelectorAll(".word-in")).toHaveLength(5);
    expect(container.querySelector(".stream-caret")).toBeNull();
    for (const node of container.querySelectorAll(".word-in")) {
      expect(node.textContent?.trim()).not.toBe("");
    }
  });

  it("caps the animated burst so a whole answer cannot spin at once", () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const { container } = render(<StreamingText text={words} live />);
    expect(container.querySelectorAll(".word-in").length).toBeLessThanOrEqual(28);
    expect(container.querySelector(".stream-caret")).not.toBeNull();
  });

  it("renders no caret for an empty live answer", () => {
    const { container } = render(<StreamingText text="" live />);
    expect(container.querySelector(".stream-caret")).toBeNull();
  });
});

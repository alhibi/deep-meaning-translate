import { fireEvent, render } from "@testing-library/react";
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
    expect(container.querySelectorAll(".word-in")).toHaveLength(0);
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

  it("does not restart a word's animation for each incoming letter", () => {
    const { container, rerender } = render(<StreamingText text="Hal" live />);
    const word = container.querySelector(".word-in")!;
    rerender(<StreamingText text="Hallo" live />);
    expect(container.querySelector(".word-in")).toBe(word);
    expect(word.textContent).toBe("Hallo");
    fireEvent.animationEnd(word);
    // jsdom exposes the prefixed CSS property but not AnimationEvent; React then
    // subscribes to WebKit's spelling. A real Chromium journey covers standard events.
    fireEvent(word, new Event("webkitAnimationEnd", { bubbles: true }));
    expect(container.querySelector(".word-in")).toBeNull();
    rerender(<StreamingText text="Hallo Welt" live />);
    expect([...container.querySelectorAll(".word-in")].map((e) => e.textContent)).toEqual(["Welt"]);
  });

  it("keeps exact whitespace and paragraph breaks", () => {
    const text = "  مرحباً  بك\n\nHallo\tWelt  ";
    const { container } = render(<StreamingText text={text} />);
    expect(container.textContent).toBe(text);
  });

  it("renders no caret for an empty live answer", () => {
    const { container } = render(<StreamingText text="" live />);
    expect(container.querySelector(".stream-caret")).toBeNull();
  });
});

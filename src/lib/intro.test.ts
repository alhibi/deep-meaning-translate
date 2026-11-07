import { beforeEach, describe, expect, it } from "vitest";
import {
  INTRO_BOOT,
  introPending,
  markIntroSeen,
  releaseIntroGate,
  shouldShowIntro,
} from "./intro";

describe("first introduction", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-intro");
  });

  it("shows once and stays dismissed after entry", () => {
    expect(shouldShowIntro()).toBe(true);
    markIntroSeen();
    expect(shouldShowIntro()).toBe(false);
  });

  it("the pre-paint gate is released as soon as an intro is entered", () => {
    // The boot script puts this attribute on <html>; entry must take it away before
    // the exit animation, so the translator is already there when the intro leaves.
    document.documentElement.setAttribute("data-intro", "open");
    expect(introPending()).toBe(true);
    markIntroSeen();
    expect(introPending()).toBe(false);
    expect(localStorage.getItem("lingua.intro.seen.v1")).toBe("1");
  });

  it("releasing the gate twice is harmless", () => {
    document.documentElement.setAttribute("data-intro", "open");
    releaseIntroGate();
    releaseIntroGate();
    expect(introPending()).toBe(false);
  });

  it("the boot script reads the same key and writes the same attribute", () => {
    // Guards a rename in either file: a gate that looks for another key would hold
    // every visit, or none.
    expect(INTRO_BOOT).toContain("lingua.intro.seen.v1");
    expect(INTRO_BOOT).toContain('setAttribute("data-intro","open")');
  });

  it("stays silent when storage is blocked, so the app is never hidden by an intro it cannot remember", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new DOMException("SecurityError");
    };
    try {
      expect(shouldShowIntro()).toBe(false);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

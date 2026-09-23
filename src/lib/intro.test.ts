import { beforeEach, describe, expect, it } from "vitest";
import { markIntroSeen, shouldShowIntro } from "./intro";

describe("first introduction", () => {
  beforeEach(() => localStorage.clear());

  it("shows once and stays dismissed after entry", () => {
    expect(shouldShowIntro()).toBe(true);
    markIntroSeen();
    expect(shouldShowIntro()).toBe(false);
  });
});

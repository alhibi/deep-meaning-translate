import { describe, expect, it } from "vitest";
import { speechLang } from "./speech";

describe("speechLang", () => {
  it("listens in the chosen source language", () => {
    expect(speechLang("de", "ar", "ar")).toBe("de-DE");
    expect(speechLang("ar", "de", "de")).toBe("ar-SA");
  });
  it("when detecting, listens for the other side of the pair", () => {
    expect(speechLang("auto", "ar", "ar")).toBe("de-DE");
    expect(speechLang("auto", "de", "ar")).toBe("ar-SA");
  });
});

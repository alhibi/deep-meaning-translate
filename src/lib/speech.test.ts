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

describe("speech extras", () => {
  it("listens in the chosen Arabic dialect", () => {
    expect(speechLang("ar", "de", "ar", "egypt")).toBe("ar-EG");
    expect(speechLang("ar", "de", "ar", "auto")).toBe("ar-SA");
  });
  it("joins chunks without losing or doubling text", async () => {
    const { joinSpeech } = await import("./speech");
    expect(joinSpeech("مرحبا", "", "  كيف  حالك ")).toBe("مرحبا كيف حالك");
  });
});

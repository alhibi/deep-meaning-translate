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

describe("mergeSpeech (Android echo repair)", async () => {
  const { mergeSpeech } = await import("./speech");
  it("fixes the real reported case", () => {
    const chunks = ["اذهب", "اذهب انت", "اذهب انت", "اذهب انت الى", "اذهب انت الى المدرسة"];
    let acc = "";
    for (const c of chunks) acc = mergeSpeech(acc, c);
    expect(acc).toBe("اذهب انت الى المدرسة");
    expect(mergeSpeech("", "اذهب اذهب انت اذهب انت اذهب انت الى اذهب انت الى المدرسه")).toBe(
      "اذهب انت الى المدرسه",
    );
  });
  it("keeps genuinely new text and overlaps", () => {
    expect(mergeSpeech("ich gehe", "gehe heute nach Hause")).toBe("ich gehe heute nach Hause");
    expect(mergeSpeech("guten Morgen", "wie geht's")).toBe("guten Morgen wie geht's");
    expect(mergeSpeech("كيف حالك", "حالك")).toBe("كيف حالك");
  });
});

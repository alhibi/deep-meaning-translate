import { describe, expect, it } from "vitest";
import { assemblyText, assemblyUrl, ASSEMBLY_MODEL } from "./assembly";

describe("AssemblyAI dictation", () => {
  it("uses AssemblyAI multilingual streaming with Arabic and German steering", () => {
    expect(ASSEMBLY_MODEL).toBe("universal-3-6-pro");
    for (const lang of ["ar-SA", "de-DE"]) {
      const url = new URL(assemblyUrl("test-session", lang));
      expect(url.hostname).toBe("streaming.assemblyai.com");
      expect(url.searchParams.get("language_codes")).toBe(JSON.stringify([lang.slice(0, 2)]));
    }
    expect(new URL(assemblyUrl("test-session", "auto")).searchParams.has("language_codes")).toBe(false);
  });
  it("replaces interim turns without deleting intentional repetitions", () => {
    const turns = new Map<number, string>();
    assemblyText(turns, { type: "Turn", turn_order: 0, transcript: "لا", end_of_turn: false });
    expect(assemblyText(turns, { type: "Turn", turn_order: 0, transcript: "لا لا", end_of_turn: true })?.text).toBe("لا لا");
    expect(assemblyText(turns, { type: "Turn", turn_order: 1, transcript: "لا لا", end_of_turn: true })?.text).toBe("لا لا لا لا");
    expect(assemblyText(turns, { type: "Turn", turn_order: 0, transcript: "لا، لا!", end_of_turn: true })?.text).toBe("لا، لا! لا لا");
  });
  it("rejects corrupted provider events without modifying recognized text", () => {
    const turns = new Map([[0, "Hallo"]]);
    expect(assemblyText(turns, { type: "Turn", turn_order: -1, transcript: {}, end_of_turn: true })).toBeNull();
    expect([...turns.values()]).toEqual(["Hallo"]);
  });
});
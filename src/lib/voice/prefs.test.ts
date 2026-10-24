import { beforeEach, describe, expect, it, vi } from "vitest";
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});
describe("voice preference migration", () => {
  it("preserves a legacy device voice when v2 JSON is corrupt and persists migration", async () => {
    localStorage.setItem("lingua.voice.v2", "{broken");
    localStorage.setItem(
      "lingua.voice.v1",
      JSON.stringify({ engine: "device", voice: "Kore", pace: "slow" }),
    );
    const { getVoicePrefs } = await import("./prefs");
    expect(getVoicePrefs().engine).toBe("device");
    expect(getVoicePrefs().pace).toBe("slow");
    expect(JSON.parse(localStorage.getItem("lingua.voice.v2") ?? "null").engine).toBe("device");
    localStorage.removeItem("lingua.voice.v1");
    vi.resetModules();
    expect((await import("./prefs")).getVoicePrefs().engine).toBe("device");
  });
});

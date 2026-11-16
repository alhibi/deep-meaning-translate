import { describe, expect, it } from "vitest";
import { canvasStage } from "./stage";

const base = { hasText: false, hasResult: false, live: false };

describe("canvasStage", () => {
  it("opens idle only when nothing was written and nothing was answered", () => {
    expect(canvasStage(base)).toBe("idle");
  });

  it("gives the room to the composer while the draft has no answer yet", () => {
    expect(canvasStage({ ...base, hasText: true })).toBe("writing");
  });

  it("lets a settled answer take the room", () => {
    expect(canvasStage({ ...base, hasText: true, hasResult: true })).toBe("settled");
  });

  it("treats a live request or stream as in progress, even over an older answer", () => {
    expect(canvasStage({ ...base, hasText: true, hasResult: true, live: true })).toBe(
      "translating",
    );
  });
});

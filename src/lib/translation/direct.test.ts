import { describe, expect, it } from "vitest";
import { deltaFromSsePayload } from "./direct";

describe("DeepSeek SSE parsing", () => {
  it("reads a content delta and ignores non-content events", () => {
    expect(
      deltaFromSsePayload(JSON.stringify({ choices: [{ delta: { content: "مرحبا" } }] })),
    ).toBe("مرحبا");
    expect(deltaFromSsePayload(JSON.stringify({ choices: [{ delta: {} }] }))).toBe("");
    expect(deltaFromSsePayload("[DONE]")).toBe("");
    expect(deltaFromSsePayload("not json")).toBe("");
  });
});

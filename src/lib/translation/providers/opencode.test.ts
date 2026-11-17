import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranslationRequest } from "../types";
import { createOpenCodeLunaProvider } from "./opencode.server";

const request: TranslationRequest = {
  text: "مرحبا",
  source: "ar",
  target: "de",
  style: "natural",
  dialect: "auto",
  brain: "luna",
  partial: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("Sona provider contract", () => {
  it("sends Sona to GPT Luna 6 on the OpenCode Responses endpoint", async () => {
    // A failure is enough: the request is built before the response is parsed.
    const fetchMock = vi.fn(() => Promise.resolve(new Response("busy", { status: 500 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createOpenCodeLunaProvider("test-key").translate(request)).rejects.toMatchObject({
      kind: "provider",
    });

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://opencode.ai/zen/go/v1/responses");
    const body = JSON.parse(String(call[1].body)) as { model?: string };
    expect(body.model).toBe("gpt-6-luna");
  });
});

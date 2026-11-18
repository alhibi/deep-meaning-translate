import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranslationRequest } from "../types";
import {
  createOpenCodeLunaProvider,
  openCodeSessionId,
  streamFullTranslation,
  streamLiveTranslation,
} from "./opencode.server";

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
    const body = JSON.parse(String(call[1].body)) as {
      model?: string;
      prompt_cache_key?: string;
      input: { content: string }[];
    };
    expect(body.model).toBe("gpt-6-luna");
    // A stable prompt cache key is independent of the routing session.
    expect(body.prompt_cache_key).toBe("lingua-translator");
    expect(body.input[0]?.content).toContain("SONA:");
    expect(body.input[1]?.content).toContain("SONA natural:");
    expect(body.input[0]?.content).not.toContain("VELO:");

    const headers = call[1].headers as Record<string, string>;
    const session = headers["x-opencode-session"];
    expect(session).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    // The gateway documents a companion header; both name the same valid session.
    expect(headers["x-opencode-session-id"]).toBe(session);
  });

  it("sends Sona guidance in full, salvage and repair even if the request omits its brain", async () => {
    const bodies: { input: { content: string }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as { input: { content: string }[] });
        return Promise.resolve(
          new Response('{"output_text":"{\\"translation\\":\\"Hallo\\"}"}', { status: 200 }),
        );
      }),
    );
    const { brain: _brain, ...req } = request;
    await streamFullTranslation("test-key", req);
    await streamLiveTranslation("test-key", req);
    const previous = {
      sourceLanguage: "ar",
      targetLanguage: "de",
      translation: "Hallo",
      tone: "",
      formality: "neutral",
      confidence: 1,
      isAmbiguous: false,
      alternativeTranslations: [],
      notes: "",
    };
    await createOpenCodeLunaProvider("test-key").repair(req, previous, ["missing number"]);
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expect(body.input[0]?.content).toContain("SONA:");
      expect(body.input[1]?.content).toContain("SONA natural:");
      expect(body.input[0]?.content).not.toContain("VELO:");
    }
  });

  it("uses a valid, fresh routing session per request", async () => {
    expect(openCodeSessionId(() => 0.5)).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    const ids = new Set(Array.from({ length: 20 }, () => openCodeSessionId()));
    expect(ids.size).toBe(20);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { streamDeepSeekFull, streamDeepSeekLive } from "./deepseek.server";
import type { TranslationRequest } from "../types";

afterEach(() => vi.unstubAllGlobals());

/** Captures the JSON body the provider would receive and answers with a tiny valid stream. */
function captureBody() {
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Promise.resolve(
        new Response(
          'data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          { status: 200 },
        ),
      );
    }),
  );
  return sent;
}

async function drain(stream: AsyncGenerator<string>) {
  for await (const _ of stream) {
    /* consume so the protocol completion is checked */
  }
}

const request: TranslationRequest = {
  text: "ا".repeat(5_000),
  source: "ar",
  target: "de",
  style: "natural",
  dialect: "auto",
  brain: "deepseek",
  partial: false,
};

describe("DeepSeek request budget", () => {
  it("gives a 5,000-character full translation the raised structured ceiling", async () => {
    const sent = captureBody();
    await drain(await streamDeepSeekFull("test-key", request));
    const body = sent[0];
    expect(body?.["max_tokens"]).toBe(13_000);
    // The verified defect: 4,096 truncated a 5,000-character full answer.
    expect(body?.["max_tokens"]).not.toBe(4_096);
    expect(body?.["response_format"]).toEqual({ type: "json_object" });
    expect(body?.["model"]).toBe("deepseek-flash");
    expect(body?.["stream"]).toBe(true);
  });

  it("gives the live stream a wide but tighter ceiling", async () => {
    const sent = captureBody();
    await drain(await streamDeepSeekLive("test-key", request));
    expect(sent[0]?.["max_tokens"]).toBe(7_500);
    expect(sent[0]?.["response_format"]).toBeUndefined();
  });
});

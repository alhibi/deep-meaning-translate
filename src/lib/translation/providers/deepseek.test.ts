import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chat,
  createDeepSeekProvider,
  streamDeepSeekFull,
  streamDeepSeekLive,
} from "./deepseek.server";
import type { TranslationRequest, TranslationResult } from "../types";
import { TranslationError } from "../types";

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

/** Captures request bodies and answers each with one non-streaming completion payload. */
function captureJson(payload: unknown) {
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Promise.resolve(Response.json(payload));
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

const previous: TranslationResult = {
  sourceLanguage: "ar",
  targetLanguage: "de",
  translation: "Hallo",
  tone: "",
  formality: "neutral",
  confidence: 0.8,
  isAmbiguous: false,
  alternativeTranslations: [],
  notes: "",
};

const errorOf = async (run: Promise<unknown>): Promise<Error & { kind?: string }> =>
  (await run.then(() => null).catch((error: Error & { kind?: string }) => error)) ??
  new Error("resolved");

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
    const messages = body?.["messages"] as { content: string }[];
    expect(messages[0]?.content).toContain("VELO:");
    expect(messages[1]?.content).toContain("VELO natural:");
    expect(messages[0]?.content).not.toContain("SONA:");
  });

  it("gives the live stream a wide but tighter ceiling", async () => {
    const sent = captureBody();
    await drain(await streamDeepSeekLive("test-key", request));
    expect(sent[0]?.["max_tokens"]).toBe(7_500);
    expect(sent[0]?.["response_format"]).toBeUndefined();
    const messages = sent[0]?.["messages"] as { content: string }[];
    expect(messages[0]?.content).toContain("VELO:");
    expect(messages[1]?.content).toContain("VELO natural:");
  });
});

describe("documented per-task capability shapes", () => {
  it("disables the default thinking mode explicitly on the fast live and settled paths", async () => {
    const sent = captureBody();
    await drain(await streamDeepSeekFull("test-key", request));
    await drain(await streamDeepSeekLive("test-key", request));
    expect(sent).toHaveLength(2);
    for (const body of sent) {
      expect(body["thinking"]).toEqual({ type: "disabled" });
      expect(body["reasoning_effort"]).toBeUndefined();
      expect(body["temperature"]).toBe(0.3);
    }
  });

  it("allows documented reasoning in the quiet repair pass and keeps room for the answer", async () => {
    const sent = captureJson({
      choices: [{ message: { content: '{"translation":"Hallo"}' }, finish_reason: "stop" }],
    });
    const repaired = await createDeepSeekProvider("test-key").repair(request, previous, [
      "Numbers missing from the translation: 3",
    ]);
    expect(repaired.translation).toBe("Hallo");
    const body = sent[0];
    expect(body?.["thinking"]).toEqual({ type: "enabled" });
    expect(body?.["reasoning_effort"]).toBe("high");
    // Documented: temperature has no effect in thinking mode, so it is not pretended.
    expect(body?.["temperature"]).toBeUndefined();
    expect(body?.["response_format"]).toEqual({ type: "json_object" });
    expect(body?.["max_tokens"]).toBeGreaterThanOrEqual(32_768);
    const messages = body?.["messages"] as { content: string }[];
    expect(messages[0]?.content).toContain("VELO:");
    expect(messages[1]?.content).toContain("VELO natural:");
  });

  it("exposes the deepest analysis profile for dictionary and shadow callers", async () => {
    const sent = captureJson({
      choices: [{ message: { content: "null" }, finish_reason: "stop" }],
    });
    await expect(
      chat("test-key", "system", "user", { profile: "analysis", chars: 72 }),
    ).resolves.toBe("null");
    const body = sent[0];
    expect(body?.["thinking"]).toEqual({ type: "enabled" });
    expect(body?.["reasoning_effort"]).toBe("max");
    expect(body?.["response_format"]).toEqual({ type: "json_object" });
    expect(body?.["max_tokens"]).toBe(65_536);
  });
});

describe("non-streaming completion contract (TD35)", () => {
  it("accepts the documented normal stop", async () => {
    captureJson({
      choices: [{ message: { content: '{"translation":"Hallo"}' }, finish_reason: "stop" }],
    });
    await expect(chat("test-key", "system", "user")).resolves.toBe('{"translation":"Hallo"}');
  });

  it.each(["length", "content_filter", "tool_calls", "insufficient_system_resource", "aborted"])(
    "rejects finish_reason %s as a provider error instead of malformed output",
    async (reason) => {
      captureJson({
        choices: [{ message: { content: '{"translation":"half' }, finish_reason: reason }],
      });
      const error = await errorOf(chat("test-key", "system", "user"));
      expect(error).toBeInstanceOf(TranslationError);
      expect(error.kind).toBe("provider");
    },
  );

  it("rejects a reply whose completion the provider never reported", async () => {
    captureJson({ choices: [{ message: { content: '{"translation":"Hallo"}' } }] });
    const error = await errorOf(chat("test-key", "system", "user"));
    expect(error).toBeInstanceOf(TranslationError);
    expect(error.kind).toBe("provider");
  });

  it("does not retry a cut reply: a handed-off response is never replayed", async () => {
    const sent = captureJson({
      choices: [{ message: { content: '{"translation":"half' }, finish_reason: "length" }],
    });
    await errorOf(chat("test-key", "system", "user"));
    expect(sent).toHaveLength(1);
  });
});

describe("long input guard", () => {
  it("fails loudly before the request when the source cannot fit the documented context", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const huge: TranslationRequest = { ...request, text: "x".repeat(400_000) };
    await expect(streamDeepSeekFull("test-key", huge)).rejects.toMatchObject({ kind: "input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

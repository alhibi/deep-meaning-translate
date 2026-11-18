import { afterEach, describe, expect, it, vi } from "vitest";
import { callPromptDirect, deltaFromSsePayload, directDeltas, streamDirect } from "./direct";
import { TranslationError } from "./types";

// Direct mode needs a personal key before it touches fetch; a device-only key is never real here.
vi.mock("./providerKey", () => ({ readProviderKey: () => "sk-direct-unit-test" }));

afterEach(() => vi.unstubAllGlobals());

/** Feeds an SSE body one byte at a time so every event is split across chunk reads. */
async function consume(text: string) {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
      c.close();
    },
  });
  const output: string[] = [];
  for await (const delta of directDeltas(body)) output.push(delta);
  return output.join("");
}

function streamResponse(text: string) {
  return new Response(text, { status: 200 });
}

const request = {
  text: "Hallo",
  source: "de",
  target: "ar",
  style: "natural",
  dialect: "auto",
  brain: "deepseek",
  partial: false,
};

const delta = 'data: {"choices":[{"delta":{"content":"مرحبا"}}]}\n\n';
const stop = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
const truncated = 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n';
const filtered = 'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\n';

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

describe("direct SSE completion contract (TD34)", () => {
  it("accepts a normal stop, with or without the [DONE] terminator", async () => {
    expect(await consume(delta + stop)).toBe("مرحبا");
    expect(await consume(delta + stop + "data: [DONE]\n\n")).toBe("مرحبا");
  });

  it("rejects a length-cut reply even when [DONE] follows", async () => {
    await expect(consume(delta + truncated + "data: [DONE]\n\n")).rejects.toMatchObject({
      kind: "provider",
    });
    await expect(consume(delta + truncated)).rejects.toMatchObject({ kind: "provider" });
  });

  it("rejects a content-filtered or unrecognised finish reason", async () => {
    await expect(consume(delta + filtered + "data: [DONE]\n\n")).rejects.toMatchObject({
      kind: "provider",
    });
    await expect(
      consume(delta + 'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n'),
    ).rejects.toMatchObject({ kind: "provider" });
  });

  it("rejects partial text followed by premature EOF", async () => {
    await expect(consume(delta)).rejects.toMatchObject({ kind: "provider" });
  });

  it("rejects a provider error envelope but tolerates keep-alive lines", async () => {
    await expect(consume(delta + 'data: {"error":{"message":"failed"}}\n\n')).rejects.toMatchObject(
      { kind: "provider" },
    );
    expect(await consume(": ping\n\n" + delta + "data: {not json}\n\n" + stop)).toBe("مرحبا");
  });

  it("never lets reasoning_content reach the screen", async () => {
    const reasoning = 'data: {"choices":[{"delta":{"reasoning_content":"secret thoughts"}}]}\n\n';
    expect(await consume(reasoning + delta + stop)).toBe("مرحبا");
  });

  it("accepts [DONE] from a provider that sends no finish reason, like the server reader", async () => {
    expect(await consume(delta + "data: [DONE]")).toBe("مرحبا");
  });
});

describe("direct request capability shapes", () => {
  it("sends the full settled request as documented JSON output without thinking", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return Promise.resolve(streamResponse(delta + stop));
      }),
    );
    const result = await streamDirect(request, new AbortController().signal, () => {}, "full");
    expect(result).toEqual({ ok: true, text: "مرحبا" });
    expect(bodies[0]?.["thinking"]).toEqual({ type: "disabled" });
    expect(bodies[0]?.["temperature"]).toBe(0.3);
    expect(bodies[0]?.["response_format"]).toEqual({ type: "json_object" });
    expect(bodies[0]?.["stream"]).toBe(true);
    const messages = bodies[0]?.["messages"] as { content: string }[];
    expect(messages[0]?.content).toContain("VELO:");
    expect(messages[1]?.content).toContain("VELO natural:");
  });

  it("keeps the live request plain text with no JSON envelope", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return Promise.resolve(streamResponse(delta + stop));
      }),
    );
    await streamDirect(request, new AbortController().signal, () => {}, "live");
    expect(bodies[0]?.["thinking"]).toEqual({ type: "disabled" });
    expect(bodies[0]?.["response_format"]).toBeUndefined();
  });

  it("reports a caller cancellation before hand-off as cancelled, not as an error", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new DOMException("Cancelled", "AbortError"))),
    );
    expect(await streamDirect(request, controller.signal, () => {}, "live")).toEqual({
      ok: false,
      kind: "provider",
      cancelled: true,
    });
  });

  it("returns a provider error for a cut reply and never replays it through the buffered transport", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(streamResponse(delta + truncated)));
    vi.stubGlobal("fetch", fetchMock);
    const result = await streamDirect(request, new AbortController().signal, () => {}, "full");
    expect(result).toEqual({ ok: false, kind: "provider" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("direct post-hand-off cancellation (TD40)", () => {
  it("cancels the active SSE body reader when the caller aborts mid-stream", async () => {
    const ctrl = new AbortController();
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(delta));
        // never close: the phone has to be able to walk away from a live stream
      },
      cancel() {
        cancelled += 1;
      },
    });
    const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const painted: string[] = [];
    const pending = streamDirect(request, ctrl.signal, (t) => painted.push(t), "live");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(painted.length).toBeGreaterThan(0); // the response was already handed off
    ctrl.abort();
    const result = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve("still-reading"), 100)),
    ]);
    // Before the fix this promise never settled: abort only reached the pre-header fetch.
    expect(result).not.toBe("still-reading");
    expect(result).toMatchObject({ ok: false, cancelled: true });
    expect(cancelled).toBeGreaterThan(0);
    // Aborting after hand-off is a cancellation, never a reason to replay the buffered
    // Android transport for an answer nobody wants.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not commit a reply that completed after the caller left", async () => {
    const ctrl = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse(delta + stop)),
    );
    // Cancel from inside the paint callback: the protocol completion arrives afterwards,
    // so only the post-loop cancellation check can classify this correctly.
    const result = await streamDirect(request, ctrl.signal, () => ctrl.abort(), "live");
    expect(result).toMatchObject({ ok: false, cancelled: true });
  });

  it("releases the reader on abort and tolerates repeated aborts", async () => {
    const ctrl = new AbortController();
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(delta));
      },
      cancel() {
        cancelled += 1;
      },
    });
    const consume = (async () => {
      for await (const _chunk of directDeltas(body, ctrl.signal)) {
        // first event arrives, then the caller leaves
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 0));
    ctrl.abort();
    ctrl.abort();
    await expect(consume).rejects.toMatchObject({ kind: "provider" });
    expect(cancelled).toBeGreaterThan(0);
  });
});

describe("direct non-streaming completion contract (TD35)", () => {
  const reply = (content: string, finishReason: unknown) =>
    Response.json({ choices: [{ message: { content }, finish_reason: finishReason }] });

  it("classifies a cut repair reply as a provider error", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return Promise.resolve(reply('{"translation":"half', "length"));
      }),
    );
    const error = (await callPromptDirect("system", "user", true, 5).catch(
      (caught: unknown) => caught,
    )) as TranslationError;
    expect(error).toBeInstanceOf(TranslationError);
    expect(error.kind).toBe("provider");
    expect(bodies[0]?.["thinking"]).toEqual({ type: "enabled" });
    expect(bodies[0]?.["reasoning_effort"]).toBe("high");
    expect(bodies[0]?.["max_tokens"]).toBeGreaterThanOrEqual(32_768);
  });

  it("accepts a stopped repair reply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(reply('{"translation":"Hallo"}', "stop"))),
    );
    await expect(callPromptDirect("system", "user", true, 5)).resolves.toBe(
      '{"translation":"Hallo"}',
    );
  });
});

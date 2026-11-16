import { describe, expect, it } from "vitest";
import { textDeltas } from "./opencode.server";

/** Feeds the SSE text one byte at a time: every event is split across chunk reads. */
async function consume(text: string) {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
      c.close();
    },
  });
  const output: string[] = [];
  for await (const delta of textDeltas(body)) output.push(delta);
  return output.join("");
}

const delta = 'data: {"choices":[{"delta":{"content":"مرحبا"}}]}\n\n';
const stop = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
const truncated = 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n';
const filtered = 'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\n';

describe("translation stream integrity", () => {
  it("rejects partial text followed by premature EOF", async () => {
    await expect(consume(delta)).rejects.toMatchObject({ kind: "provider" });
  });

  it("rejects a provider error envelope after text", async () => {
    await expect(consume(delta + 'data: {"error":{"message":"failed"}}\n\n')).rejects.toMatchObject(
      { kind: "provider" },
    );
  });

  it("accepts an OpenAI stop finish_reason, with or without [DONE]", async () => {
    expect(await consume(delta + stop)).toBe("مرحبا");
    expect(await consume(delta + stop + "data: [DONE]\n\n")).toBe("مرحبا");
    expect(
      await consume('data: {"choices":[{"delta":{"content":"Hallo"},"finish_reason":"stop"}]}\n\n'),
    ).toBe("Hallo");
  });

  it("rejects [DONE] after finish_reason=length: a cut answer is not a success", async () => {
    await expect(consume(delta + truncated + "data: [DONE]\n\n")).rejects.toMatchObject({
      kind: "provider",
    });
    // Without the terminator it must not become a success through EOF either.
    await expect(consume(delta + truncated)).rejects.toMatchObject({ kind: "provider" });
  });

  it("rejects a content-filtered reply", async () => {
    await expect(consume(delta + filtered + "data: [DONE]\n\n")).rejects.toMatchObject({
      kind: "provider",
    });
  });

  it("rejects an unrecognised finish_reason instead of assuming success", async () => {
    await expect(
      consume(delta + 'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n'),
    ).rejects.toMatchObject({ kind: "provider" });
  });

  it("accepts completed Responses SSE", async () => {
    expect(
      await consume(
        'data: {"type":"response.output_text.delta","delta":"Hallo"}\n\n' +
          'data: {"type":"response.completed"}\n\n',
      ),
    ).toBe("Hallo");
  });

  it("rejects a Responses incomplete event", async () => {
    await expect(
      consume(
        'data: {"type":"response.output_text.delta","delta":"Hallo"}\n\n' +
          'data: {"type":"response.incomplete"}\n\n',
      ),
    ).rejects.toMatchObject({ kind: "provider" });
  });

  it("rejects a failed Responses stream", async () => {
    await expect(
      consume('data: {"type":"response.failed","response":{"status":"failed"}}\n\n'),
    ).rejects.toMatchObject({ kind: "provider" });
  });

  it("accepts completed DeepSeek SSE including a final line without newline", async () => {
    expect(await consume(delta + "data: [DONE]")).toBe("مرحبا");
  });

  it("tolerates non-data lines and non-JSON keep-alives", async () => {
    expect(await consume(": ping\n\n" + delta + "data: {not json}\n\n" + stop)).toBe("مرحبا");
  });
});

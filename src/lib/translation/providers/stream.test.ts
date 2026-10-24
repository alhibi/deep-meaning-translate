import { describe, expect, it } from "vitest";
import { textDeltas } from "./opencode.server";

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
describe("translation stream integrity", () => {
  it("rejects partial text followed by premature EOF", async () => {
    await expect(consume(delta)).rejects.toMatchObject({ kind: "provider" });
  });
  it("rejects a provider error envelope after text", async () => {
    await expect(consume(delta + 'data: {"error":{"message":"failed"}}\n\n')).rejects.toMatchObject(
      { kind: "provider" },
    );
  });
  it("accepts completed DeepSeek SSE including a final line without newline", async () => {
    expect(await consume(delta + "data: [DONE]")).toBe("مرحبا");
  });
  it("accepts completed Responses SSE", async () => {
    expect(
      await consume(
        'data: {"type":"response.output_text.delta","delta":"Hallo"}\n\ndata: {"type":"response.completed"}\n\n',
      ),
    ).toBe("Hallo");
  });
});

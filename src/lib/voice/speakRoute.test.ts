import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
import { Route } from "@/routes/api/speak";
const handler = (Route as unknown as { server: { handlers: { POST: (args: { request: Request }) => Promise<Response> } } }).server.handlers.POST;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const pcm = btoa("x".repeat(80));
const audio = `data: ${JSON.stringify({ event_type: "step.delta", delta: { type: "audio", data: pcm } })}\n\n`;
async function response(text: string, close = true) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(text)); if (close) c.close(); }, cancel });
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
  const request = new Request("https://fluently.today/api/speak", { method: "POST", headers: { Origin: "https://fluently.today" }, body: JSON.stringify({ text: "Hallo", lang: "de", voice: "Kore", quality: "fast", pace: "normal" }) });
  return { res: await handler({ request }), cancel };
}
describe("Gemini route stream integrity", () => {
  it("rejects audio followed by EOF without provider completion", async () => {
    const { res } = await response(audio);
    await expect(res.arrayBuffer()).rejects.toThrow();
  });
  it("accepts complete PCM and a terminal event without trailing newline", async () => {
    const { res } = await response(audio + 'data: {"event_type":"interaction.completed"}');
    expect((await res.arrayBuffer()).byteLength).toBe(80);
  });
  it("provider errors cancel the unfinished upstream body", async () => {
    const { res, cancel } = await response('data: {"event_type":"error","error":{"message":"failed"}}\n\n', false);
    await expect(res.arrayBuffer()).rejects.toThrow();
    expect(cancel).toHaveBeenCalled();
  });
});
import { describe, expect, it } from "vitest";
import { boundedJson, sameOrigin } from "./requestSafety";
import { createLimiter } from "./translation/throttle";

describe("request admission", () => {
  it("one abusive client cannot consume another client's translation allowance", () => {
    const take = createLimiter();
    for (let i = 0; i < 30; i++) expect(take("A")).toBe(true);
    expect(take("A")).toBe(false);
    expect(take("B")).toBe(true);
  });
  it("isolates 3000 simultaneous client identities", () => {
    const take = createLimiter();
    for (let i = 0; i < 3000; i++) expect(take(String(i))).toBe(true);
    for (let i = 0; i < 3000; i++) expect(take(String(i))).toBe(true);
  });
  it("rejects cross-site browser spending and accepts the app origin", () => {
    expect(sameOrigin(new Request("https://fluently.today/api/speak", { headers: { Origin: "https://evil.example" } }))).toBe(false);
    expect(sameOrigin(new Request("https://fluently.today/api/speak", { headers: { Origin: "https://fluently.today" } }))).toBe(true);
  });
  it("cancels oversized chunked JSON without relying on Content-Length", async () => {
    let sent = false;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) { if (!sent) { sent = true; c.enqueue(new TextEncoder().encode('"' + "x".repeat(1025))); } },
      cancel() { cancelled = true; },
    });
    const request = new Request("https://fluently.today/api/speak", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(boundedJson(request, 1024)).rejects.toThrow("input");
    expect(cancelled).toBe(true);
  });
  it("reads split Unicode JSON without damaging Arabic", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ text: "مرحباً" }));
    const body = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } });
    const request = new Request("https://fluently.today", { method: "POST", body, duplex: "half" } as RequestInit);
    expect(await boundedJson(request)).toEqual({ text: "مرحباً" });
  });
});
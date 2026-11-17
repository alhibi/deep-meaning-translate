import { afterEach, describe, expect, it, vi } from "vitest";
import { streamTranslate } from "./stream";

afterEach(() => vi.unstubAllGlobals());

/** A fetch response whose body streams the given byte chunks, split exactly where passed. */
const streamedResponse = (chunks: Uint8Array[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
  );

describe("streamTranslate", () => {
  it("classifies the server's quiet 204 cancel as a cancellation, not a provider failure", async () => {
    // The translate-stream route answers 204 when the caller's own request was aborted
    // upstream. It carries no body, so reading it as JSON used to throw and surface a
    // "provider" error with a retry — a failure the person never caused.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const res = await streamTranslate({}, new AbortController().signal, () => {}, "live");
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ cancelled: true });
  });

  it("still reports a real error status with its kind", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: false, kind: "rate" }, { status: 429 })),
    );
    const res = await streamTranslate({}, new AbortController().signal, () => {}, "live");
    expect(res).toEqual({ ok: false, kind: "rate" });
  });

  it("gives the caller's signal to the upstream fetch", async () => {
    const ctrl = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = streamTranslate({ text: "Hallo." }, ctrl.signal, () => {}, "live");
    ctrl.abort();
    const res = await pending;
    // The abort reached the fetch the route/provider would see, and it is a quiet end:
    // a cancelled request must never be classified as a retryable provider failure.
    expect(fetchMock.mock.calls[0]![1].signal).toBe(ctrl.signal);
    expect(res).toMatchObject({ cancelled: true });
  });

  it("keeps text intact when a UTF-8 character is split across chunks", async () => {
    const bytes = new TextEncoder().encode("مرحبا \u{1F600} بالعالم");
    // Deliberately cut through the multi-byte Arabic letters and the emoji surrogate
    // pair's four UTF-8 bytes: the decoder must stream, not drop half a character.
    const cut = [
      bytes.slice(0, 3),
      bytes.slice(3, 9),
      bytes.slice(9, bytes.length - 2),
      bytes.slice(-2),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamedResponse(cut)),
    );
    const painted: string[] = [];
    const res = await streamTranslate(
      {},
      new AbortController().signal,
      (t) => painted.push(t),
      "live",
    );
    expect(res).toEqual({ ok: true, text: "مرحبا \u{1F600} بالعالم" });
    expect(painted.at(-1)).toBe("مرحبا \u{1F600} بالعالم");
    expect([...painted.at(-1)!].length).toBe(15);
  });

  it("stops reading and reports a cancellation when the consumer aborts mid-stream", async () => {
    const ctrl = new AbortController();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new TextEncoder().encode("Hallo"));
        // never close: the caller has to be able to walk away from a live stream
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const pending = streamTranslate({}, ctrl.signal, () => {}, "live");
    await new Promise((resolve) => setTimeout(resolve, 0));
    ctrl.abort();
    const res = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve("still-reading"), 100)),
    ]);
    expect(res).not.toBe("still-reading");
    expect(res).toMatchObject({ cancelled: true });
  });

  it("releases the response body of a failed request nobody reads", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{}"));
          },
          cancel,
        });
        return new Response(body, {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await streamTranslate({}, new AbortController().signal, () => {}, "live");
    expect(cancel).toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const capacitorPost = vi.fn();

vi.mock("./config", () => ({
  isNativeApp: () => true,
  nativeApiUrl: (path: string) => `https://api.today.test${path}`,
}));
vi.mock("@capacitor/core", () => ({
  CapacitorHttp: { post: (...args: unknown[]) => capacitorPost(...args) },
}));

const { nativeJson, nativeRequest } = await import("./transport");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  capacitorPost.mockReset();
});

const url = "/api/native/v1/lexicon";

/** A fetch that stays pending until its signal aborts, like a hung WebView request. */
function hangingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
  );
}

describe("native transport cancellation", () => {
  it("does not even open a request for a signal that is already aborted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(nativeJson(url, {}, 30_000, ctrl.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(nativeRequest(url, { signal: ctrl.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(capacitorPost).not.toHaveBeenCalled();
  });

  it("aborts the actual fetch when the caller cancels mid-flight", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = new AbortController();
    const pending = nativeJson(url, {}, 30_000, ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    // The composed signal reached fetch and was aborted, so the WebView cancels the
    // connection instead of leaving it open to its own deadline.
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.signal?.aborted).toBe(true);
    // A cancelled quiet request must not be replayed through the buffered Android stack.
    expect(capacitorPost).not.toHaveBeenCalled();
  });

  it("a transport timeout aborts the underlying fetch, not just a local promise", async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const pending = nativeJson(url, {}, 5_000);
    const assertion = expect(pending).rejects.toMatchObject({
      name: "NativeTransportError",
      kind: "timeout",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    // The deadline fired on the same signal the fetch owns: the provider request is
    // cancelled instead of being abandoned while it keeps streaming.
    expect(fetchMock.mock.calls[0]![1]!.signal?.aborted).toBe(true);
    // A WebView deadline keeps the pre-existing availability rule (one Android-stack
    // retry); only a caller cancellation suppresses that fallback (see the cancel test).
    expect(capacitorPost).toHaveBeenCalledTimes(1);
  });

  it("cancels the active response-body reader when the caller aborts after headers", async () => {
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":'));
      },
      cancel() {
        cancelled += 1;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const ctrl = new AbortController();
    const pending = nativeJson(url, {}, 30_000, ctrl.signal);
    // Let the body reader start, then walk away while read() is pending.
    await new Promise((resolve) => setTimeout(resolve, 0));
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBeGreaterThan(0);
    expect(capacitorPost).not.toHaveBeenCalled();
  });

  it("keeps the plain timeout verdict when nobody cancelled", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());
    const pending = nativeJson(url, {}, 1_000);
    const assertion = expect(pending).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it("repeated aborts settle once and leave no timer behind", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());
    const ctrl = new AbortController();
    const pending = nativeJson(url, {}, 60_000, ctrl.signal);
    ctrl.abort();
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    // The composed deadline timer was released with the request.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back to the Android stack only for a transport failure, never for a cancel", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    vi.stubGlobal("fetch", fetchMock);
    capacitorPost.mockResolvedValue({ status: 200, data: { ok: true, lexicon: null } });
    await expect(nativeJson(url, {}, 30_000)).resolves.toEqual({ ok: true, lexicon: null });
    expect(capacitorPost).toHaveBeenCalledTimes(1);
  });
});

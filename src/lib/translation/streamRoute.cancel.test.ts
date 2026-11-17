// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The web `/api/translate-stream` route only owns the same-origin rule; the provider work
 * and its cancellation live in the shared handler it delegates to. These tests exercise
 * that chain end to end with a mocked provider: a client disconnect must abort the
 * real upstream request (its signal), close the response quietly, and release the
 * provider stream body.
 */
const provider = vi.hoisted(() => ({
  live: vi.fn(),
  full: vi.fn(),
}));

vi.mock("./providers/deepseek.server", () => ({
  deepseekKey: () => "test-key",
  streamDeepSeekLive: (...args: unknown[]) => provider.live(...args),
  streamDeepSeekFull: (...args: unknown[]) => provider.full(...args),
}));

const { handleTranslateStream } = await import("./streamRoute.server");

afterEach(() => {
  provider.live.mockReset();
  provider.full.mockReset();
  vi.useRealTimers();
});

const URL = "http://localhost:8080/api/translate-stream";

function request(ctrl?: AbortController): Request {
  return new Request(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Hallo", source: "de", target: "ar", style: "natural" }),
    ...(ctrl ? { signal: ctrl.signal } : {}),
  });
}

describe("web translate-stream cancellation", () => {
  it("aborts the upstream provider and closes the stream when the client disconnects", async () => {
    const ctrl = new AbortController();
    let upstream: AbortSignal | undefined;
    provider.live.mockImplementation((_key: string, _req: unknown, signal: AbortSignal) => {
      upstream = signal;
      return (async function* () {
        yield "مر";
        // The provider keeps generating until the connection is cancelled.
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new DOMException("Aborted", "AbortError");
      })();
    });

    const response = await handleTranslateStream(request(ctrl));
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("مر");

    // The browser tab disappears mid-answer.
    ctrl.abort();
    const end = await reader.read();
    // The response ends quietly (no error chunk, no provider error), and the upstream
    // request the provider owns saw its own abort signal.
    expect(end.done).toBe(true);
    expect(upstream?.aborted).toBe(true);
  });

  it("cancels upstream work started before the headers and answers 204", async () => {
    const ctrl = new AbortController();
    let upstream: AbortSignal | undefined;
    provider.live.mockImplementation(
      async (_key: string, _req: unknown, signal: AbortSignal): Promise<never> => {
        upstream = signal;
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new DOMException("Aborted", "AbortError");
      },
    );

    const pending = handleTranslateStream(request(ctrl));
    await new Promise((resolve) => setTimeout(resolve, 0));
    ctrl.abort();
    const response = await pending;
    expect(response.status).toBe(204);
    expect(upstream?.aborted).toBe(true);
  });

  it("releases the upstream provider generator when the response body is cancelled", async () => {
    let upstream: AbortSignal | undefined;
    let released = false;
    provider.live.mockImplementation((_key: string, _req: unknown, signal: AbortSignal) => {
      upstream = signal;
      return (async function* () {
        try {
          yield "مر";
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", () => resolve(), { once: true });
          });
          throw new DOMException("Aborted", "AbortError");
        } finally {
          released = true;
        }
      })();
    });

    const response = await handleTranslateStream(request());
    const reader = response.body!.getReader();
    await reader.read();
    // The consumer cancels the response body (what the runtime does on a dropped socket).
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(upstream?.aborted).toBe(true);
    expect(released).toBe(true);
  });
});

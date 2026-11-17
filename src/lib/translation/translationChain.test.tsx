import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Acceptance A/B through the real foreground chain: hook → stream client → fetch.
 * Only the review transport is mocked; the streaming client under test is the real one.
 */

vi.mock("../native/rpc", () => ({ callRepair: vi.fn(async () => ({ ok: true, result: null })) }));
vi.mock("./translate.functions", () => ({ translate: {}, repairTranslation: {} }));

const { useTranslator } = await import("./useTranslator");
const { memoryClear } = await import("./memory");

const enc = new TextEncoder();
const opts = (text: string) => ({ text, source: "de", target: "ar", style: "natural" as const });
const flush = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** A body that paints one chunk and then keeps the connection open until cancelled. */
function openBody(initial: string) {
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(initial));
    },
    cancel() {
      cancelled += 1;
    },
  });
  return { body, cancelled: () => cancelled };
}

let posts: { signal?: AbortSignal | undefined }[] = [];
let firstBody: ReturnType<typeof openBody> | null = null;
const fetchMock = vi.fn(async (_url: string, init: RequestInit = {}) => {
  if (init.method !== "POST") return new Response(null, { status: 204 });
  posts.push({ signal: init.signal ?? undefined });
  if (posts.length === 1) {
    firstBody = openBody("أ");
    return new Response(firstBody.body, { status: 200 });
  }
  return new Response(enc.encode("أهلاً بك"), { status: 200 });
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  posts = [];
  firstBody = null;
  memoryClear();
  localStorage.clear();
});
afterEach(() => {
  memoryClear();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("A → B request lifecycle through the real chain", () => {
  it("aborts the replaced stream at hook/stream/fetch and lets only B commit", async () => {
    const { result, rerender } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Hallo"),
    });
    await flush(600);
    expect(posts).toHaveLength(1);
    const signalA = posts[0]!.signal;
    expect(signalA).toBeInstanceOf(AbortSignal);
    expect(signalA!.aborted).toBe(false);
    expect(firstBody).not.toBeNull();

    // B replaces A (not an append-only extension) while A's response is still streaming.
    rerender(opts("Tschüss"));
    await flush(1);
    expect(signalA!.aborted).toBe(true);
    // The reader was cancelled: the socket/provider request is released, not orphaned.
    expect(firstBody!.cancelled()).toBeGreaterThan(0);

    await flush(900);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.signal?.aborted).toBe(false);
    // A's stream can never commit after the replacement; B owns the visible answer.
    expect(result.current.result?.translation).toBe("أهلاً بك");
    expect(result.current.stale).toBe(false);
  });
});

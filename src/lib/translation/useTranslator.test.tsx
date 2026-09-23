import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { TranslationResult } from "./types";

const call = vi.fn();
const repairCall = vi.fn();
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: { kind?: string }) => (fn.kind === "repair" ? repairCall : call),
}));
vi.mock("./translate.functions", () => ({ translate: {}, repairTranslation: { kind: "repair" } }));
// Live (partial) requests stream; route them through the same mock so behaviour stays testable.
vi.mock("./stream", () => ({
  warmTranslation: () => {},
  streamTranslate: async (
    data: unknown,
    signal: AbortSignal,
    onText: (t: string) => void,
    mode: string,
  ) => {
    const r = await call({ data, signal });
    if (!r.ok) return r;
    onText(r.result.translation);
    return { ok: true, text: mode === "full" ? JSON.stringify(r.result) : r.result.translation };
  },
}));

const result = (translation: string): TranslationResult => ({
  sourceLanguage: "de",
  targetLanguage: "ar",
  translation,
  tone: "",
  formality: "neutral",
  confidence: 0.9,
  isAmbiguous: false,
  alternativeTranslations: [],
  notes: "",
});

const { useTranslator } = await import("./useTranslator");
const opts = (text: string) => ({ text, source: "de", target: "ar", style: "natural" as const });
const flush = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  call.mockReset();
  repairCall.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("useTranslator", () => {
  it("settles a live result once typing pauses (action buttons appear)", async () => {
    call.mockResolvedValue({ ok: true, result: result("مرحبا") });
    const { result: h } = renderHook((p) => useTranslator(p), { initialProps: opts("Hallo Welt") });
    await flush(1000);
    expect(h.current.result?.translation).toBe("مرحبا");
    expect(h.current.provisional).toBe(true);
    await flush(1500);
    expect(h.current.provisional).toBe(false);
  });

  it("ignores stale replies and never duplicates requests", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    call
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValue({ ok: true, result: result("جديد") });
    const { result: h, rerender } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Hallo."),
    });
    await flush(300);
    rerender(opts("Tschüss."));
    await flush(300);
    resolveFirst({ ok: true, result: result("قديم") });
    await flush(50);
    expect(h.current.result?.translation).toBe("جديد");
    rerender(opts("Tschüss."));
    await flush(1000);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good result when a later request fails", async () => {
    call
      .mockResolvedValueOnce({ ok: true, result: result("جيد") })
      .mockResolvedValue({ ok: false, kind: "auth" });
    const { result: h, rerender } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Gut."),
    });
    await flush(500);
    rerender(opts("Gut gemacht."));
    await flush(500);
    expect(h.current.result?.translation).toBe("جيد");
    expect(h.current.error).toBe("auth");
  });

  it("serves a repeated text from cache", async () => {
    call.mockResolvedValue({ ok: true, result: result("x") });
    const { rerender } = renderHook((p) => useTranslator(p), { initialProps: opts("Eins.") });
    await flush(500);
    rerender(opts("Zwei."));
    await flush(500);
    rerender(opts("Eins."));
    await flush(500);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("shows streamed live text as it arrives", async () => {
    call.mockResolvedValue({ ok: true, result: result("مرحبا يا") });
    const { result: h } = renderHook((p) => useTranslator(p), { initialProps: opts("Hallo du") });
    await flush(1000);
    expect(h.current.result?.translation).toBe("مرحبا يا");
    expect(h.current.result?.alternativeTranslations).toEqual([]);
  });

  it("shows the first translation at once and swaps in a quiet repair", async () => {
    call.mockResolvedValue({ ok: true, result: result("أولى") });
    let finish: (v: unknown) => void = () => {};
    repairCall.mockImplementation(() => new Promise((r) => (finish = r)));
    const { result: h } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Ich habe 3 Katzen."),
    });
    await flush(500);
    expect(h.current.result?.translation).toBe("أولى");
    expect(repairCall).toHaveBeenCalledTimes(1);
    finish({ ok: true, result: result("مصححة 3") });
    await flush(50);
    expect(h.current.result?.translation).toBe("مصححة 3");
  });

  it("keeps an earlier live stream flowing while typing continues", async () => {
    const signals: AbortSignal[] = [];
    let resolveFirst: (v: unknown) => void = () => {};
    call
      .mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
        signals.push(signal);
        return new Promise((r) => (resolveFirst = r));
      })
      .mockImplementation(({ signal }: { signal: AbortSignal }) => {
        signals.push(signal);
        return new Promise(() => {});
      });
    const { result: h, rerender } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Ich wollte "),
    });
    await flush(600);
    rerender(opts("Ich wollte dir "));
    await flush(600);
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(false);
    resolveFirst({ ok: true, result: result("كنت أريد") });
    await flush(20);
    expect(h.current.result?.translation).toBe("كنت أريد");
    rerender(opts("Etwas anderes"));
    await flush(600);
    expect(signals[1]!.aborted).toBe(true);
  });

  it("translates word by word during non-stop fast typing", async () => {
    call.mockImplementation(() => new Promise(() => {}));
    const { rerender } = renderHook((p) => useTranslator(p), { initialProps: opts("I") });
    const words = "Ich wollte dir heute nur kurz sagen dass ".split("");
    let typed = "";
    for (const ch of words) {
      typed += ch;
      rerender(opts(typed));
      await flush(90);
    }
    expect(call.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

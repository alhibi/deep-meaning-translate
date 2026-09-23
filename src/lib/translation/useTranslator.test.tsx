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
  streamTranslate: async (data: unknown, signal: AbortSignal, onText: (t: string) => void) => {
    const r = await call({ data, signal });
    if (!r.ok) return r;
    onText(r.result.translation);
    return { ok: true, text: r.result.translation };
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
    call.mockResolvedValue({ ok: true, result: result("أولى"), needsRepair: true });
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
});

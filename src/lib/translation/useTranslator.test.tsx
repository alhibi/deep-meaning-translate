import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DEFAULT_BRAIN, type TranslationResult } from "./types";

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
const { memoryClear } = await import("./memory");
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
  // Device memory outlives a render on purpose — that is the feature. jsdom shares
  // localStorage across tests in a file, so without this a sentence settled by one
  // test would answer the next one from storage and the network path would never run.
  memoryClear();
  localStorage.clear();
});
afterEach(() => {
  memoryClear();
  localStorage.clear();
  vi.useRealTimers();
});

describe("useTranslator", () => {
  it("shows a primed translation for a dialect without spending a request", async () => {
    // A restored session must open stable: the primed key has to include the dialect
    // and the brain, exactly as the first real request would.
    const success = vi.fn();
    const { result: h } = renderHook((p) => useTranslator({ ...p, onSuccess: success }), {
      initialProps: {
        text: "Hallo.",
        source: "de",
        target: "ar",
        style: "natural" as const,
        dialect: "levant" as const,
      },
    });
    act(() =>
      h.current.prime(
        "Hallo.",
        { source: "de", target: "ar", style: "natural", dialect: "levant", brain: DEFAULT_BRAIN },
        result("أهلاً"),
      ),
    );
    await flush(400);
    expect(call).not.toHaveBeenCalled();
    expect(h.current.result?.translation).toBe("أهلاً");
    expect(h.current.phase).toBe("COMPLETE");
  });

  it("invalidates a pending reply and retry after deletion to one character", async () => {
    let finish: (value: unknown) => void = () => {};
    const success = vi.fn();
    call.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const { result: h, rerender } = renderHook((p) => useTranslator({ ...p, onSuccess: success }), {
      initialProps: opts("Hallo."),
    });
    await flush(300);
    rerender(opts("H"));
    finish({ ok: true, result: result("قديم") });
    await flush(300);
    expect(h.current.result).toBeNull();
    expect(success).not.toHaveBeenCalled();
    act(() => h.current.retry());
    await flush(300);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("ignores an obsolete repair while newer input is pending", async () => {
    let finish: (value: unknown) => void = () => {};
    const success = vi.fn();
    repairCall.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    call
      .mockResolvedValueOnce({ ok: true, result: result("أولى") })
      .mockImplementation(() => new Promise(() => {}));
    const { result: h, rerender } = renderHook((p) => useTranslator({ ...p, onSuccess: success }), {
      initialProps: opts("Ich habe 3 Katzen."),
    });
    await flush(500);
    rerender(opts("Etwas Neues."));
    await flush(500);
    finish({ ok: true, result: result("إصلاح قديم") });
    await flush(20);
    expect(h.current.result?.translation).toBe("أولى");
    expect(success).toHaveBeenCalledTimes(1);
  });
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

  it("does not spend a quiet repair round trip when a clean result has no reviewer", async () => {
    call.mockResolvedValue({ ok: true, result: result("أهلاً") });
    const { result: h } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Hallo."),
    });
    await flush(600);
    expect(h.current.result?.translation).toBe("أهلاً");
    expect(h.current.phase).toBe("COMPLETE");
    // DeepSeek wrote a clean sentence while Luna is paused: there is nobody to review it.
    expect(repairCall).not.toHaveBeenCalled();
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

  it("opens a carried-over result immediately and spends no request", async () => {
    const carried = result("محفوظة");
    const { result: h } = renderHook((p) => useTranslator(p), {
      initialProps: { ...opts("Guten Morgen."), restored: carried },
    });
    // Returning from another route: the first paint already shows the translation.
    expect(h.current.result?.translation).toBe("محفوظة");
    expect(h.current.phase).toBe("COMPLETE");
    await flush(1500);
    expect(call).not.toHaveBeenCalled();
    expect(h.current.result?.translation).toBe("محفوظة");
  });
});

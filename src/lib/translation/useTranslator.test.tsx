import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DEFAULT_BRAIN, type TranslationResult } from "./types";

const call = vi.fn();
const repairCall = vi.fn();
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: { kind?: string }) => (fn.kind === "repair" ? repairCall : call),
}));
vi.mock("./translate.functions", () => ({ translate: {}, repairTranslation: { kind: "repair" } }));
vi.mock("../native/rpc", () => ({ callRepair: repairCall }));
// Live (partial) requests stream; route them through the same mock so behaviour stays testable.
vi.mock("./stream", () => ({
  warmTranslation: () => {},
  streamTranslate: async (
    data: unknown,
    signal: AbortSignal,
    onText: (t: string) => void,
    mode: string,
  ) => {
    const r = await call({ data, signal, onText });
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
  Reflect.deleteProperty(navigator, "onLine");
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

  it("salvages a provider-cut structured answer as plain text instead of failing", async () => {
    call
      .mockResolvedValueOnce({ ok: false, kind: "provider" })
      .mockResolvedValueOnce({ ok: true, result: result("نسخة منقذة") });
    const { result: h } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Ein langer Satz."),
    });
    await flush(900);
    expect(h.current.result?.translation).toBe("نسخة منقذة");
    expect(h.current.error).toBeNull();
    expect(h.current.phase).toBe("COMPLETE");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("salvages an unreadable structured reply once, then shows the plain answer", async () => {
    call
      .mockResolvedValueOnce({ ok: true, result: result("") })
      .mockResolvedValueOnce({ ok: true, result: result("أنقذتني") });
    const { result: h } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Ein langer Satz."),
    });
    await flush(900);
    expect(h.current.result?.translation).toBe("أنقذتني");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("never treats an authentication error as salvageable", async () => {
    call.mockResolvedValue({ ok: false, kind: "auth" });
    const { result: h } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Ein langer Satz."),
    });
    await flush(900);
    expect(h.current.error).toBe("auth");
    expect(call).toHaveBeenCalledTimes(1);
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

describe("draft/result ownership", () => {
  it("cancels an obsolete request as soon as the draft changes, before debounce", async () => {
    let finish: (value: unknown) => void = () => {};
    const success = vi.fn();
    call.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { result: h, rerender } = renderHook((p) => useTranslator({ ...p, onSuccess: success }), {
      initialProps: opts("Ein alter Satz."),
    });
    await flush(50);
    const signal = call.mock.calls[0]![0].signal as AbortSignal;
    rerender(opts("Ein anderer Gedanke"));
    expect(signal.aborted).toBe(true);
    finish({ ok: true, result: result("إجابة قديمة") });
    await flush(20);
    expect(h.current.result).toBeNull();
    expect(success).not.toHaveBeenCalled();
  });

  it("cancels a newer request when undo returns to the answer already on screen", async () => {
    let finish: (value: unknown) => void = () => {};
    call
      .mockResolvedValueOnce({ ok: true, result: result("الأصل") })
      .mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { result: h, rerender } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Original."),
    });
    await flush(100);
    rerender(opts("Bearbeitet."));
    await flush(100);
    const signal = call.mock.calls[1]![0].signal as AbortSignal;
    rerender(opts("Original."));
    expect(signal.aborted).toBe(true);
    finish({ ok: true, result: result("لا تخص النص المستعاد") });
    await flush(500);
    expect(h.current.result?.translation).toBe("الأصل");
    expect(h.current.pending).toBe(false);
  });

  it("shows a shorter replacement stream immediately after deleting words", async () => {
    call
      .mockResolvedValueOnce({
        ok: true,
        result: result("هذه ترجمة سابقة أطول بكثير من البديل الجديد"),
      })
      .mockImplementation(() => new Promise(() => {}));
    const { result: h, rerender } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Ein sehr langer ursprünglicher Satz."),
    });
    await flush(100);
    rerender(opts("Kurz"));
    await flush(400);
    act(() => call.mock.calls[1]![0].onText("قصير"));
    await flush(20);
    expect(h.current.result?.translation).toBe("قصير");
    expect(h.current.provisional).toBe(true);
  });

  it("does not duplicate an explicit submission while the same full request is running", async () => {
    call.mockImplementation(() => new Promise(() => {}));
    const { result: h } = renderHook((p) => useTranslator(p), { initialProps: opts("Hallo.") });
    await flush(100);
    act(() => {
      h.current.translateNow("Hallo.");
      h.current.translateNow("Hallo.");
    });
    await flush(100);
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("composition and settled identity", () => {
  it("does not translate an IME buffer, retry it, or let the watchdog submit it", async () => {
    call.mockResolvedValue({ ok: true, result: result("日本語") });
    const { result: h, rerender } = renderHook((p) => useTranslator(p), {
      initialProps: { ...opts("にほん"), composing: true },
    });
    await flush(5000);
    expect(call).not.toHaveBeenCalled();
    act(() => {
      h.current.translateNow("にほん");
      h.current.retry();
    });
    await flush(2000);
    expect(call).not.toHaveBeenCalled();
    rerender({ ...opts("日本語"), composing: false });
    await flush(500);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]![0].data.text).toBe("日本語");
  });

  it("cancels a scheduled retry when composition starts without changing text", async () => {
    call.mockResolvedValue({ ok: false, kind: "network" });
    const { rerender } = renderHook((p) => useTranslator(p), {
      initialProps: { ...opts("Hallo."), composing: false },
    });
    await flush(100);
    rerender({ ...opts("Hallo."), composing: true });
    await flush(5000);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("marks the old answer unusable immediately, including while waiting to schedule", async () => {
    call
      .mockResolvedValueOnce({ ok: true, result: result("الترجمة الأصلية") })
      .mockImplementation(() => new Promise(() => {}));
    const { result: h, rerender } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Original."),
    });
    await flush(100);
    expect(h.current.settled).toBe(true);
    rerender(opts("New draft"));
    expect(h.current.stale).toBe(true);
    expect(h.current.settled).toBe(false);
    expect(h.current.pending).toBe(false);
    expect(h.current.result?.translation).toBe("الترجمة الأصلية");
    rerender(opts("Original."));
    expect(h.current.stale).toBe(false);
    expect(h.current.settled).toBe(true);
  });

  it.each([
    { source: "auto" },
    { target: "de" },
    { style: "formal" as const },
    { dialect: "levant" as const },
    { brain: "luna" as const },
  ])("invalidates the request immediately on a parameter change: %j", async (change) => {
    call.mockImplementation(() => new Promise(() => {}));
    const initial = { ...opts("Ein Satz."), dialect: "auto" as const, brain: DEFAULT_BRAIN };
    const { rerender } = renderHook((p) => useTranslator(p), {
      initialProps: initial as Parameters<typeof useTranslator>[0],
    });
    await flush(50);
    const signal = call.mock.calls[0]![0].signal as AbortSignal;
    rerender({ ...initial, ...change });
    expect(signal.aborted).toBe(true);
  });

  it("gets a full verified reading after a pause instead of relabelling a live guess", async () => {
    let finish: (value: unknown) => void = () => {};
    const success = vi.fn();
    call
      .mockResolvedValueOnce({ ok: true, result: result("مبدئية") })
      .mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { result: h } = renderHook((p) => useTranslator({ ...p, onSuccess: success }), {
      initialProps: opts("Hallo Welt"),
    });
    await flush(100); // commit the live response and install its idle timer
    await flush(1500);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1]![0].data.partial).toBe(false);
    expect(h.current.settled).toBe(false);
    expect(success.mock.calls.filter((c) => c[2] === false)).toHaveLength(0);
    finish({ ok: true, result: result("نهائية") });
    await flush(30);
    expect(h.current.settled).toBe(true);
    expect(h.current.streaming).toBe(false);
    expect(success.mock.calls.filter((c) => c[2] === false)).toHaveLength(1);
  });

  it("treats a transport that resolves after abort as a timeout, not a retryable network error", async () => {
    call.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ ok: false, kind: "network" }));
        }),
    );
    const { result: h } = renderHook((p) => useTranslator(p), { initialProps: opts("Hallo.") });
    await flush(60_100);
    expect(h.current.error).toBe("timeout");
    expect(h.current.pending).toBe(false);
    await flush(3000);
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("foreground recovery", () => {
  it("upgrades a rate-limited live request after the pause even when an old answer exists", async () => {
    call
      .mockResolvedValueOnce({ ok: true, result: result("سابقة") })
      .mockResolvedValueOnce({ ok: false, kind: "rate" })
      .mockResolvedValue({ ok: true, result: result("جديدة") });
    const { result: h, rerender } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Original."),
    });
    await flush(100);
    rerender(opts("Neuer Gedanke"));
    await flush(400);
    expect(h.current.error).toBeNull();
    await flush(1300);
    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls[2]![0].data.partial).toBe(false);
    expect(h.current.result?.translation).toBe("جديدة");
    expect(h.current.settled).toBe(true);
  });

  it("streams a shorter explicitly recovered DOM value before it completes", async () => {
    call
      .mockResolvedValueOnce({ ok: true, result: result("نتيجة أطول بكثير من البديل الجديد") })
      .mockImplementation(() => new Promise(() => {}));
    const { result: h } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Langer alter Satz."),
    });
    await flush(100);
    act(() => h.current.translateNow("Kurz"));
    act(() => call.mock.calls[1]![0].onText("قصير"));
    await flush(20);
    expect(h.current.result?.translation).toBe("قصير");
  });

  it("never carries a previous draft's detected source into a fresh auto-source live answer", async () => {
    call
      .mockResolvedValueOnce({ ok: true, result: { ...result("أولى"), sourceLanguage: "de" } })
      .mockResolvedValue({ ok: true, result: result("جديدة") });
    const { result: h, rerender } = renderHook((p) => useTranslator(p), {
      initialProps: { ...opts("Original."), source: "auto" },
    });
    await flush(100);
    rerender({ ...opts("Nouveau texte"), source: "auto" });
    await flush(400);
    expect(h.current.result?.sourceLanguage).toBe("auto");
    expect(h.current.provisional).toBe(true);
  });
});

describe("interrupted editing sessions", () => {
  it("keeps a current settled answer usable and persistable when connectivity drops", async () => {
    call.mockResolvedValue({ ok: true, result: result("ترجمة محفوظة") });
    const { result: h } = renderHook((p) => useTranslator(p), {
      initialProps: opts("Guten Morgen."),
    });
    await flush(100);
    expect(h.current.settled).toBe(true);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    act(() => window.dispatchEvent(new Event("offline")));
    // Connectivity is reported by OfflinePill. It cannot invalidate a reading that
    // is already complete, or the route would overwrite its session with result:null.
    expect(h.current.settled).toBe(true);
    expect(h.current.error).toBeNull();
    expect(h.current.result?.translation).toBe("ترجمة محفوظة");
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    act(() => window.dispatchEvent(new Event("online")));
    await flush(100);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("stops streaming cues offline, ignores late chunks, and resumes the current draft online", async () => {
    call
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({ ok: true, result: result("عادت الترجمة") });
    const { result: h } = renderHook((p) => useTranslator(p), { initialProps: opts("Hallo.") });
    await flush(100);
    const first = call.mock.calls[0]![0];
    act(() => first.onText("جزء ظاهر"));
    await flush(20);
    expect(h.current.streaming).toBe(true);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    act(() => window.dispatchEvent(new Event("offline")));
    expect(first.signal.aborted).toBe(true);
    expect(h.current.streaming).toBe(false);
    expect(h.current.error).toBe("offline");
    act(() => first.onText("وصول متأخر"));
    await flush(30);
    expect(h.current.result?.translation).toBe("جزء ظاهر");
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    act(() => window.dispatchEvent(new Event("online")));
    await flush(50);
    expect(h.current.result?.translation).toBe("عادت الترجمة");
    expect(h.current.settled).toBe(true);
    expect(h.current.error).toBeNull();
  });

  it("aborts and retires buffered paints/completions when the translator unmounts", async () => {
    let finish: (value: unknown) => void = () => {};
    const success = vi.fn();
    call.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { unmount } = renderHook((p) => useTranslator({ ...p, onSuccess: success }), {
      initialProps: opts("Hallo."),
    });
    await flush(100);
    const first = call.mock.calls[0]![0];
    act(() => first.onText("جزء مخزن للرسم"));
    unmount();
    finish({ ok: true, result: result("لا تعرضني") });
    await flush(100);
    expect(first.signal.aborted).toBe(true);
    expect(success).not.toHaveBeenCalled();
  });
});

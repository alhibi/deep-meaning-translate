import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpeakHandlers } from "@/lib/tts";
import { ResultPanel } from "./ResultPanel";

const calls = vi.hoisted(() => [] as SpeakHandlers[]);
vi.mock("@/lib/tts", () => ({
  prefetchSpeech: vi.fn(),
  stopSpeaking: vi.fn(),
  speakTranslation: (_text: string, _lang: string, handlers: SpeakHandlers) => {
    calls.push(handlers);
    return vi.fn();
  },
}));
const result = {
  translation: "Hallo schöne Welt",
  sourceLanguage: "ar",
  targetLanguage: "de",
  tone: "neutral",
  formality: "neutral",
  confidence: 1,
  isAmbiguous: false,
  alternativeTranslations: [],
  notes: "",
  situation: "general" as const,
};
afterEach(() => {
  cleanup();
  calls.length = 0;
  vi.useRealTimers();
});
describe("read-along playback ownership", () => {
  it("ignores old word and end callbacks after stopping and replaying", () => {
    render(
      <ResultPanel
        result={result}
        target="de"
        pending={false}
        provisional={false}
        error={null}
        onRetry={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    act(() => {
      calls[0]?.onStart?.();
      calls[0]?.onWord?.(6, true);
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    act(() => {
      calls[1]?.onStart?.();
      calls[1]?.onWord?.(0, true);
    });
    act(() => {
      calls[0]?.onWord?.(13, true);
      calls[0]?.onEnd?.();
    });
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(document.querySelector('.spoken-word[data-state="now"]')?.textContent).toBe("Hallo");
  });
  it("restarts estimation when a new device chunk has no word events", async () => {
    vi.useFakeTimers();
    render(
      <ResultPanel
        result={result}
        target="de"
        pending={false}
        provisional={false}
        error={null}
        onRetry={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    act(() => {
      calls[0]?.onStart?.();
      calls[0]?.onWord?.(0, true);
      calls[0]?.onWord?.(6, false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });
    expect(document.querySelector('.spoken-word[data-state="now"]')?.textContent).toBe("Welt");
  });
});

describe("copy action", () => {
  it("copies the exact translation and confirms in place", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <ResultPanel
        result={result}
        target="de"
        pending={false}
        provisional={false}
        error={null}
        onRetry={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy translation" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("Hallo schöne Welt");
    const btn = screen.getByRole("button", { name: "Copied" });
    expect(btn.textContent).toBe("Copied");
  });
});

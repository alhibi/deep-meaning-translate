import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stopSpeaking, type SpeakHandlers } from "@/lib/tts";
import { ResultPanel } from "./ResultPanel";

const calls = vi.hoisted(() => [] as SpeakHandlers[]);
const prefetchSpeech = vi.hoisted(() => vi.fn());
const warmVoice = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tts", () => ({
  prefetchSpeech,
  stopSpeaking: vi.fn(),
  speakTranslation: (_text: string, _lang: string, handlers: SpeakHandlers) => {
    calls.push(handlers);
    return vi.fn();
  },
}));
vi.mock("@/lib/voice/cloud", () => ({ warmVoice }));
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
  prefetchSpeech.mockClear();
  warmVoice.mockClear();
  vi.mocked(stopSpeaking).mockClear();
  Reflect.deleteProperty(document, "execCommand");
  Reflect.deleteProperty(navigator, "userActivation");
  vi.useRealTimers();
});
describe("read-along playback ownership", () => {
  it("never starts paid speech merely because a translation settled", async () => {
    Object.defineProperty(navigator, "userActivation", {
      value: { hasBeenActive: true },
      configurable: true,
    });
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
    await act(async () => {
      await Promise.resolve();
    });
    expect(prefetchSpeech).not.toHaveBeenCalled();
  });

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

describe("result editing states", () => {
  it("makes hidden streaming actions genuinely unavailable to keyboard users", () => {
    render(
      <ResultPanel
        result={result}
        target="de"
        pending={false}
        provisional
        error={null}
        onRetry={() => {}}
        onSave={() => {}}
      />,
    );
    const copy = document.querySelector(
      'button[aria-label="Copy translation"]',
    ) as HTMLButtonElement;
    expect(copy.disabled || !!copy.closest("[inert]")).toBe(true);
    expect(screen.queryByRole("button", { name: "Copy translation" })).toBeNull();
  });

  it("offers a retry when a stream fails after displaying partial words", () => {
    render(
      <ResultPanel
        result={result}
        target="de"
        pending={false}
        provisional
        error="network"
        onRetry={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("keeps typography unchanged when streamed words settle", () => {
    const props = { result, target: "de", pending: false, error: null, onRetry: () => {} } as const;
    const { container, rerender } = render(<ResultPanel {...props} provisional />);
    const before = container.querySelector(".result-text")!.className.replace(/opacity-\d+/g, "");
    rerender(<ResultPanel {...props} provisional={false} />);
    expect(container.querySelector(".result-text")!.className.replace(/opacity-\d+/g, "")).toBe(
      before,
    );
  });
});

describe("stale result safety", () => {
  const props = {
    result,
    target: "de",
    pending: false,
    provisional: false,
    error: null,
    onRetry: () => {},
  } as const;

  it("disables every result action and stops playback when the source changes", () => {
    const { container, rerender } = render(<ResultPanel {...props} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    act(() => calls[0]?.onStart?.());
    const stops = vi.mocked(stopSpeaking).mock.calls.length;
    rerender(<ResultPanel {...props} stale onSave={() => {}} />);
    expect(vi.mocked(stopSpeaking).mock.calls.length).toBeGreaterThan(stops);
    expect(screen.queryByRole("button", { name: "Copy translation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    for (const button of container.querySelectorAll(".result-actions button"))
      expect(button).toBeDisabled();
    act(() => {
      calls[0]?.onWord?.(6, true);
      calls[0]?.onEnd?.();
    });
    expect(container.querySelector(".spoken-word")).toBeNull();
  });

  it("does not confirm an old clipboard write on a newer draft", async () => {
    let finish: () => void = () => {};
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => new Promise<void>((resolve) => (finish = resolve)),
      },
    });
    const { container, rerender } = render(<ResultPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy translation" }));
    rerender(<ResultPanel {...props} stale />);
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(container.querySelector('button[aria-label="Copied"]')).toBeNull();
  });

  it("restores native editing focus and selection after the clipboard fallback", () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {} });
    const command = vi.fn(() => {
      expect((document.activeElement as HTMLTextAreaElement).value).toBe(result.translation);
      return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: command });
    render(
      <>
        <textarea aria-label="Draft" defaultValue="Keep my selection" />
        <ResultPanel {...props} />
      </>,
    );
    const field = screen.getByRole("textbox") as HTMLTextAreaElement;
    field.focus();
    field.setSelectionRange(2, 7);
    fireEvent.click(screen.getByRole("button", { name: "Copy translation" }));
    expect(command).toHaveBeenCalledWith("copy");
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([2, 7]);
  });
});

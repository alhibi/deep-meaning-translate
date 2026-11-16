import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const token = vi.fn();
vi.mock("./native/rpc", () => ({ callDictationToken: (...args: unknown[]) => token(...args) }));
import { useAssemblySpeech } from "./useAssemblySpeech";

afterEach(() => {
  vi.unstubAllGlobals();
  token.mockReset();
});

describe("AssemblyAI microphone lifecycle", () => {
  for (const stage of ["resume", "module"] as const) {
    it(`cancel during audio ${stage} never issues a token`, async () => {
      let release: () => void = () => {};
      const wait = new Promise<void>((r) => {
        release = r;
      });
      const close = vi.fn().mockResolvedValue(undefined);
      const stop = vi.fn();
      vi.stubGlobal("navigator", {
        mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
      });
      vi.stubGlobal(
        "AudioContext",
        class {
          state = "running";
          resume = () => (stage === "resume" ? wait : Promise.resolve());
          audioWorklet = { addModule: () => (stage === "module" ? wait : Promise.resolve()) };
          close = close;
        },
      );
      vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() });
      const { result } = renderHook(() =>
        useAssemblySpeech({ lang: "de", onText: vi.fn(), onDone: vi.fn() }),
      );
      let pending: Promise<void> | undefined;
      await act(async () => {
        pending = result.current.start();
        await Promise.resolve();
        await Promise.resolve();
      });
      act(() => result.current.cancel());
      await act(async () => {
        release();
        await pending;
      });
      expect(token).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalled();
      expect(stop).toHaveBeenCalled();
    });
  }
  it("an older final turn after stop cannot discard the latest flushed turn", async () => {
    vi.useFakeTimers();
    let socket:
      | {
          onmessage?: (e: { data: string }) => void;
          readyState: number;
          send: ReturnType<typeof vi.fn>;
          close: ReturnType<typeof vi.fn>;
        }
      | undefined;
    vi.stubGlobal(
      "WebSocket",
      class {
        static OPEN = 1;
        readyState = 1;
        send = vi.fn();
        close = vi.fn();
        onmessage?: (e: { data: string }) => void;
        constructor() {
          // eslint-disable-next-line @typescript-eslint/no-this-alias -- a test double must expose the instance it was created as
          socket = this;
        }
      },
    );
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
      },
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        state = "running";
        resume = async () => {};
        close = async () => {};
        audioWorklet = { addModule: async () => {} };
      },
    );
    vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() });
    token.mockResolvedValue({ ok: true, token: "test-token" });
    const onText = vi.fn();
    const { result, unmount } = renderHook(() =>
      useAssemblySpeech({ lang: "de", onText, onDone: vi.fn() }),
    );
    await act(async () => {
      await result.current.start();
    });
    const turn = (order: number, text: string, final: boolean) =>
      act(() =>
        socket?.onmessage?.({
          data: JSON.stringify({
            type: "Turn",
            turn_order: order,
            transcript: text,
            end_of_turn: final,
          }),
        }),
      );
    turn(1, "neue", false);
    act(() => result.current.stop());
    turn(0, "alte", true);
    expect(socket?.close).not.toHaveBeenCalled();
    turn(1, "neue Worte", true);
    act(() => socket?.onmessage?.({ data: JSON.stringify({ type: "Termination" }) }));
    expect(onText).toHaveBeenLastCalledWith("alte neue Worte", true);
    expect(socket?.close).toHaveBeenCalledTimes(1);
    unmount();
    vi.useRealTimers();
  });
  it("cancels pending microphone permission and closes late tracks without a paid request", async () => {
    const stop = vi.fn();
    let resolve: (stream: MediaStream) => void = () => {};
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((r) => {
          resolve = r;
        }),
    );
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const onText = vi.fn();
    const { result } = renderHook(() =>
      useAssemblySpeech({ lang: "ar-SA", onText, onDone: vi.fn() }),
    );
    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.start();
    });
    expect(result.current.starting).toBe(true);
    act(() => result.current.stop());
    await act(async () => {
      resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
      await pending;
    });
    expect(stop).toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
    expect(result.current.starting).toBe(false);
  });
  it("prevents duplicate starts and reports denied microphone access", async () => {
    let reject: (e: DOMException) => void = () => {};
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((_, r) => {
          reject = r;
        }),
    );
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const { result } = renderHook(() =>
      useAssemblySpeech({ lang: "de-DE", onText: vi.fn(), onDone: vi.fn() }),
    );
    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.start();
      void result.current.start();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => {
      reject(new DOMException("Denied", "NotAllowedError"));
      await pending;
    });
    expect(result.current.error).toBe("denied");
    expect(result.current.starting).toBe(false);
    expect(token).not.toHaveBeenCalled();
  });
});

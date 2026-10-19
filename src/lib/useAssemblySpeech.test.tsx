import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const token = vi.fn();
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => token }));
vi.mock("./assembly.functions", () => ({ assemblyToken: {} }));
import { useAssemblySpeech } from "./useAssemblySpeech";

afterEach(() => { vi.unstubAllGlobals(); token.mockReset(); });

describe("AssemblyAI microphone lifecycle", () => {
  it("cancels pending microphone permission and closes late tracks without a paid request", async () => {
    const stop = vi.fn();
    let resolve: (stream: MediaStream) => void = () => {};
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(r => { resolve = r; }));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const onText = vi.fn();
    const { result } = renderHook(() => useAssemblySpeech({ lang: "ar-SA", onText, onDone: vi.fn() }));
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.start(); });
    expect(result.current.starting).toBe(true);
    act(() => result.current.stop());
    await act(async () => { resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream); await pending; });
    expect(stop).toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
    expect(result.current.starting).toBe(false);
  });
  it("prevents duplicate starts and reports denied microphone access", async () => {
    let reject: (e: DOMException) => void = () => {};
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((_, r) => { reject = r; }));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const { result } = renderHook(() => useAssemblySpeech({ lang: "de-DE", onText: vi.fn(), onDone: vi.fn() }));
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.start(); void result.current.start(); });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => { reject(new DOMException("Denied", "NotAllowedError")); await pending; });
    expect(result.current.error).toBe("denied");
    expect(result.current.starting).toBe(false);
    expect(token).not.toHaveBeenCalled();
  });
});
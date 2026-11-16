import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = () => void;
const listeners = new Map<string, Listener[]>();
const remove = vi.fn(async () => undefined);
const nativePlugin = {
  available: vi.fn(async () => ({ ready: true })),
  speak: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  addListener: vi.fn(async (event: string, callback: Listener) => {
    const current = listeners.get(event) ?? [];
    current.push(callback);
    listeners.set(event, current);
    return { remove };
  }),
};

vi.mock("@capacitor/core", () => ({ registerPlugin: vi.fn(() => nativePlugin) }));

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("native TTS lifecycle", () => {
  beforeEach(() => {
    listeners.clear();
    remove.mockClear();
    nativePlugin.available.mockClear();
    nativePlugin.speak.mockClear();
    nativePlugin.stop.mockClear();
    nativePlugin.addListener.mockClear();
  });

  it("detaches all listeners after a natural end", async () => {
    const { speakNative } = await import("./tts");
    const onEnd = vi.fn();
    speakNative("Hallo", "de-DE", { onEnd }, 1);
    await flush();
    expect(nativePlugin.addListener).toHaveBeenCalledTimes(3);

    listeners.get("end")?.[0]?.();
    await flush();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledTimes(3);
  });

  it("retires the former session before a new utterance can own callbacks", async () => {
    const { speakNative } = await import("./tts");
    speakNative("eins", "de-DE", {}, 1);
    await flush();
    speakNative("zwei", "de-DE", {}, 1);
    await flush();

    // The prior three native callback handles are explicitly removed; the active
    // utterance owns only its own three handles.
    expect(remove).toHaveBeenCalledTimes(3);
    expect(nativePlugin.stop).toHaveBeenCalledTimes(1);
  });
});

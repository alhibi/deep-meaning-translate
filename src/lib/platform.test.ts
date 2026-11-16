import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hydrate = vi.fn();
vi.mock("./persistence/native", () => ({
  nativePort: { hydrate: (...args: unknown[]) => hydrate(...args) },
  markNativeHydrated: vi.fn(),
  resetNativeHydrationForTests: vi.fn(),
}));

const { markNativeHydrated } = (await import("./persistence/native")) as unknown as {
  markNativeHydrated: ReturnType<typeof vi.fn>;
};

const { hydratePlatform, platformError, platformReadySync, resetPlatformForTests } =
  await import("./platform");

/**
 * Boot must never depend on the native bridge answering. The black screen was a rejected
 * or silent `boot` leaving the boot cover up forever; these tests pin the degraded paths.
 */

type FakeCapacitor = {
  isNativePlatform: () => boolean;
  getPlatform: () => string;
};

function installCapacitor(native: boolean) {
  (window as unknown as { Capacitor: FakeCapacitor }).Capacitor = {
    isNativePlatform: () => native,
    getPlatform: () => (native ? "android" : "web"),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  hydrate.mockReset();
  markNativeHydrated.mockReset();
  resetPlatformForTests();
  installCapacitor(true);
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe("platform boot", () => {
  it("opens immediately in a browser", async () => {
    installCapacitor(false);
    expect(platformReadySync()).toBe(true);
    await expect(hydratePlatform()).resolves.toBe(true);
    expect(platformError()).toBeNull();
  });

  it("applies a real snapshot and only then opens native writes", async () => {
    hydrate.mockResolvedValue({
      settings: {},
      prefs: { source: "de", target: "ar", style: "natural" },
      session: null,
      history: [],
      historyTotal: 0,
      saved: [],
      memory: [],
    });
    const ok = await hydratePlatform();
    expect(ok).toBe(true);
    expect(platformError()).toBeNull();
    expect(markNativeHydrated).toHaveBeenCalledTimes(1);
  });

  it("a bridge answering after the timeout cannot reopen native writes", async () => {
    vi.useFakeTimers();
    let answer: ((value: unknown) => void) | null = null;
    hydrate.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const booting = hydratePlatform();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(booting).resolves.toBe(false);
    // The underlying promise resolves later, but the snapshot was never applied, so the
    // native adapter must stay closed (otherwise the first save rewrites from empty RAM).
    (answer as ((value: unknown) => void) | null)?.({
      settings: {},
      prefs: null,
      session: null,
      history: [],
      historyTotal: 0,
      saved: [],
      memory: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(markNativeHydrated).not.toHaveBeenCalled();
  });

  it("opens with in-memory data when the bridge rejects", async () => {
    hydrate.mockRejectedValue(new Error("not-implemented"));
    const ok = await hydratePlatform();
    expect(ok).toBe(false);
    expect(platformReadySync()).toBe(true);
    expect(platformError()).toBe("bridge");
  });

  it("opens after the boot timeout when the bridge never answers", async () => {
    vi.useFakeTimers();
    hydrate.mockReturnValue(new Promise(() => {}));
    const booting = hydratePlatform();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(booting).resolves.toBe(false);
    expect(platformReadySync()).toBe(true);
    expect(platformError()).toBe("timeout");
  });
});

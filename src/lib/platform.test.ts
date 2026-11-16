import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hydrate = vi.fn();
vi.mock("./persistence/native", () => ({
  nativePort: { hydrate: (...args: unknown[]) => hydrate(...args) },
}));

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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataControls } from "./DataControls";
import { history } from "@/lib/history";
import { resetSavedCache } from "@/lib/saved";

/**
 * The privacy page's Storage block is driven by two external systems (the stores and
 * `navigator.storage`), so it is tested by rendering it: the section must appear with
 * real counts, must use the browser's numbers when it has them, and must say so calmly
 * when the browser reports nothing instead of inventing a quota.
 */
beforeEach(() => {
  window.localStorage.clear();
  // The stores cache in module scope; a shared jsdom must not leak one test's archive.
  history.reload();
  resetSavedCache();
});

afterEach(() => {
  delete (navigator as unknown as { storage?: unknown }).storage;
});

const row = {
  id: "a",
  source: "de",
  target: "ar",
  original: "Hallo",
  translated: "مرحبا",
  createdAt: 1_000,
};

describe("DataControls storage section", () => {
  it("shows archive counts and the browser's usage when it is reported", async () => {
    window.localStorage.setItem("lingua.history.v1", JSON.stringify([row]));
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 1024 * 1024, quota: 100 * 1024 * 1024 }),
        persisted: async () => false,
        persist: async () => true,
      },
    });

    render(<DataControls />);

    expect(await screen.findByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("1 / 2000")).toBeInTheDocument();
    expect(screen.getByText(/of .* used/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make storage durable" })).toBeInTheDocument();
  });

  it("shows app-private storage instead of a browser quota inside the app", async () => {
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: { isNativePlatform: () => true, getPlatform: () => "android" },
    });
    try {
      render(<DataControls />);
      expect(
        await screen.findByText("Stored in app-private storage on this device."),
      ).toBeInTheDocument();
      expect(screen.queryByText("Storage usage is not reported by this browser.")).toBeNull();
      expect(screen.queryByRole("button", { name: "Make storage durable" })).toBeNull();
    } finally {
      delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    }
  });

  it("says the browser does not report storage instead of guessing", async () => {
    render(<DataControls />);
    expect(
      await screen.findByText("Storage usage is not reported by this browser."),
    ).toBeInTheDocument();
    // jsdom has no persist(); the control exists only where the browser could honour it.
    expect(screen.queryByRole("button", { name: "Make storage durable" })).toBeNull();
  });
});

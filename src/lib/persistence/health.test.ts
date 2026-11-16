import { afterEach, describe, expect, it } from "vitest";
import {
  deriveStorageHealth,
  formatStorageBytes,
  formatStoragePercent,
  readStorageHealth,
  type StorageCounts,
} from "./health";

const counts: StorageCounts = {
  archiveRows: 12,
  archiveLimit: 2000,
  savedRows: 3,
  lastWriteOk: true,
  lastEvicted: 0,
};

const reported = {
  ...counts,
  estimateSupported: true,
  usage: 25,
  quota: 100,
  durableSupported: true,
  durable: false,
};

describe("storage health derivation", () => {
  it("computes the fill only when the browser reports both numbers", () => {
    const health = deriveStorageHealth(reported);
    expect(health.fill).toBe(25);
    expect(health.trimmed).toBe(false);
    expect(health.needsAttention).toBe(false);

    expect(
      deriveStorageHealth({
        ...counts,
        estimateSupported: false,
        usage: null,
        quota: null,
        durableSupported: false,
        durable: null,
      }).fill,
    ).toBeNull();
    // A zero quota means "not reported", never a division by zero.
    expect(deriveStorageHealth({ ...reported, usage: 5, quota: 0 }).fill).toBeNull();
    expect(deriveStorageHealth({ ...reported, usage: 250, quota: 100 }).fill).toBe(100);
  });

  it("flags a refused write and a trimmed archive", () => {
    expect(deriveStorageHealth({ ...reported, lastWriteOk: false }).needsAttention).toBe(true);
    const trimmed = deriveStorageHealth({ ...reported, lastEvicted: 4 });
    expect(trimmed.trimmed).toBe(true);
    expect(trimmed.needsAttention).toBe(true);
    expect(deriveStorageHealth({ ...reported, lastEvicted: -2 }).trimmed).toBe(false);
  });
});

describe("storage formatting", () => {
  it("scales bytes and uses the interface locale", () => {
    expect(formatStorageBytes(0, "en")).toBe("0 bytes");
    expect(formatStorageBytes(1, "en")).toBe("1 byte");
    expect(formatStorageBytes(512, "en")).toBe("512 bytes");
    expect(formatStorageBytes(1536, "en")).toMatch(/1[.,]5/);
    expect(formatStorageBytes(1536, "de")).toMatch(/1[.,]5/);
    expect(formatStorageBytes(1536, "en")).not.toBe(formatStorageBytes(1536, "de"));
    // The unit label itself is localized by Intl, not a hard-coded "kB".
    expect(formatStorageBytes(1536, "en")).not.toBe(formatStorageBytes(1536, "ar"));
    expect(formatStorageBytes(2 * 1024 ** 3, "en")).toMatch(/GB/);
    expect(formatStorageBytes(Number.NaN, "en")).toBe("");
  });

  it("formats a percentage with Intl", () => {
    expect(formatStoragePercent(25, "en")).toBe("25%");
    expect(formatStoragePercent(0, "en")).toBe("0%");
    expect(formatStoragePercent(100, "en")).toBe("100%");
    expect(formatStoragePercent(25, "de")).toMatch(/25/);
  });
});

describe("readStorageHealth", () => {
  afterEach(() => {
    // jsdom has no navigator.storage; tests below add one and must remove it again.
    delete (navigator as unknown as { storage?: unknown }).storage;
  });

  it("reports nothing when the browser has no storage API", async () => {
    const health = await readStorageHealth(counts);
    expect(health.estimateSupported).toBe(false);
    expect(health.fill).toBeNull();
    expect(health.durableSupported).toBe(false);
    expect(health.durable).toBeNull();
    expect(health.needsAttention).toBe(false);
  });

  it("passes through what the browser reports", async () => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 300, quota: 1200 }),
        persisted: async () => false,
        persist: async () => true,
      },
    });
    const health = await readStorageHealth(counts);
    expect(health.estimateSupported).toBe(true);
    expect(health.fill).toBe(25);
    expect(health.durableSupported).toBe(true);
    expect(health.durable).toBe(false);
  });

  it("treats a rejected or empty estimate as not reported", async () => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => {
          throw new Error("refused");
        },
        persisted: async () => true,
        persist: async () => true,
      },
    });
    const health = await readStorageHealth(counts);
    expect(health.estimateSupported).toBe(true);
    expect(health.fill).toBeNull();
    expect(health.durable).toBe(true);
  });
});

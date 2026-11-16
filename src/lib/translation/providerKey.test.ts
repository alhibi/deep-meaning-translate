import { beforeEach, describe, expect, it } from "vitest";
import {
  clearProviderKey,
  readProviderKey,
  saveProviderKey,
  validateProviderKey,
} from "./providerKey";
import { BACKUP_SETTING_KEYS } from "../persistence/contracts";

describe("provider key", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("accepts a DeepSeek-shaped key and rejects a malformed one", () => {
    expect(validateProviderKey("sk-" + "a".repeat(32))).toBe("sk-" + "a".repeat(32));
    expect(validateProviderKey("  sk-abc123  ")).toBeNull();
    expect(validateProviderKey("AIza123")).toBeNull();
    expect(validateProviderKey("")).toBeNull();
    expect(validateProviderKey(null)).toBeNull();
  });

  it("stores the key only on the device and never in a backup", async () => {
    expect(await saveProviderKey("sk-" + "b".repeat(32))).toBe(true);
    expect(readProviderKey()).toBe("sk-" + "b".repeat(32));
    expect(BACKUP_SETTING_KEYS).not.toContain("lingua.provider.v1");
    expect(await clearProviderKey()).toBe(true);
    expect(readProviderKey()).toBeNull();
  });
});

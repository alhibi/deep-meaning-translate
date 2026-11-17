import { afterEach, describe, expect, it } from "vitest";
import {
  noteProviderFailure,
  noteProviderSuccess,
  providerCooldownRemaining,
  providerCooling,
  providerHealth,
  resetProviderHealthForTests,
  PROVIDER_COOLDOWN_MS,
} from "./health.server";

afterEach(() => resetProviderHealthForTests());

describe("provider health cooldown", () => {
  it("cooling starts only for provider failures, never for a rejected input", () => {
    expect(noteProviderFailure("luna", "input", 1_000)).toBe(0);
    expect(providerCooling("luna", 1_000)).toBe(false);

    expect(noteProviderFailure("luna", "rate", 1_000)).toBe(PROVIDER_COOLDOWN_MS.rate);
    expect(providerCooling("luna", 1_000)).toBe(true);
  });

  it("expires on its own and never affects the other writer", () => {
    noteProviderFailure("luna", "rate", 10_000);
    expect(providerCooling("luna", 10_000 + PROVIDER_COOLDOWN_MS.rate - 1)).toBe(true);
    expect(providerCooldownRemaining("luna", 10_000 + PROVIDER_COOLDOWN_MS.rate - 1)).toBe(1);
    expect(providerCooling("luna", 10_000 + PROVIDER_COOLDOWN_MS.rate)).toBe(false);
    expect(providerCooling("deepseek", 10_000)).toBe(false);
  });

  it("a success clears the writer's cooldown immediately", () => {
    noteProviderFailure("deepseek", "auth", 0);
    expect(providerCooling("deepseek", 1_000)).toBe(true);
    noteProviderSuccess("deepseek");
    expect(providerCooling("deepseek", 1_000)).toBe(false);
  });

  it("exposes a content-free snapshot for diagnostics", () => {
    noteProviderFailure("luna", "provider", 5_000);
    expect(providerHealth(5_000)).toEqual([{ brain: "luna", remainingMs: 15_000 }]);
    expect(providerHealth(5_000 + 15_000)).toEqual([]);
  });
});

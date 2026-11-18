import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contracts that are one config line away from silently regressing and that no unit test
 * of the web layer can see. Both were established on the real HONOR device: input capture
 * broke IME events (automatic translation only after Enter), and a Room trim deleted the
 * oldest archive rows (statistics changed).
 */
describe("native shell contracts", () => {
  it("keeps Capacitor input capture disabled", () => {
    const config = readFileSync("capacitor.config.ts", "utf8");
    expect(config).toMatch(/captureInput:\s*false/);
    expect(config).not.toMatch(/captureInput:\s*true/);
  });

  it("never trims the Room archive", () => {
    const repository = readFileSync(
      "android/app/src/main/java/today/fluently/app/data/LinguaRepository.kt",
      "utf8",
    );
    expect(repository).not.toMatch(/history\(\)\.trim\(/);
  });
});

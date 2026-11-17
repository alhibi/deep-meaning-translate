import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { readDeepSeekKey } from "./env";
import { probeLongInput, probeRepair } from "./probes";

/**
 * Supplementary budget probe for the other direction of the app's largest supported input.
 * Gated behind EVAL_LONG_PROBE=1 so the normal live evaluation stays one run:
 *   RUN_LIVE_EVAL=1 EVAL_LONG_PROBE=1 npx vitest run --config tests/eval/eval.config.ts
 */
const enabled = process.env["RUN_LIVE_EVAL"] === "1" && process.env["EVAL_LONG_PROBE"] === "1";
const key = readDeepSeekKey();

it.skipIf(!enabled || !key)(
  "4,900 Arabic characters produce one complete structured answer",
  async () => {
    const long = await probeLongInput(key!, "ar→de");
    process.stdout.write(`[long-probe ar→de] ${JSON.stringify(long)}\n`);
    expect(long.chars).toBe(4_900);
    expect(long.finish).toBe("stop");
    expect(long.parseOk).toBe(true);
    expect(long.outputChars ?? 0).toBeGreaterThan(2_000);
    // The only expected verifier complaints are its known number/date-format blind spots
    // (a correct 20.11. or 17 Uhr is reported as a missing number); a truncated or empty
    // answer would surface as finish "length", a parse failure, or a much shorter output.
    for (const issue of long.verifyIssues)
      expect(issue).toMatch(/^Numbers missing from the translation:/);
    let repair = null;
    if (long.translation) {
      repair = await probeRepair(key!, long.translation, "ar→de");
      process.stdout.write(`[repair-probe ar→de] ${JSON.stringify(repair)}\n`);
      expect(repair.parseOk).toBe(true);
      expect(repair.issuesAfter.length).toBeLessThanOrEqual(repair.issuesBefore.length);
    }
    const dir = path.join(
      "artifacts",
      "eval",
      `longprobe-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "long-input-ar-de.json"),
      JSON.stringify({ long, repair }, null, 2),
    );
  },
  180_000,
);

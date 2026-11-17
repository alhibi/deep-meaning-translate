import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { CURRENT_CORPUS } from "./corpus";
import { readDeepSeekKey } from "./env";
import { runEvaluation } from "./run";
import type { ConfigId } from "./providers";

/**
 * Live evaluation entry point. It is NOT part of the standing test gate: it makes paid
 * provider calls and needs a real key, and the default vitest config cannot see it.
 *
 * Baseline run (writes the committed fixture):
 *   RUN_LIVE_EVAL=1 EVAL_WRITE_FIXTURE=1 npx vitest run --config tests/eval/eval.config.ts
 *
 * Bounded smoke run (no judge, no probes):
 *   RUN_LIVE_EVAL=1 EVAL_CASE_LIMIT=4 EVAL_SKIP_JUDGE=1 EVAL_SKIP_PROBES=1 \
 *     npx vitest run --config tests/eval/eval.config.ts
 *
 * The key is read server-side from DEEPSEEK_API_KEY or the repo .env; it is never printed.
 */

const enabled = process.env["RUN_LIVE_EVAL"] === "1";
const key = readDeepSeekKey();
const fixturePath = "tests/eval/fixtures/baseline-v1.json";

function configuredCorpus() {
  const limit = Number(process.env["EVAL_CASE_LIMIT"] ?? "0");
  if (!Number.isFinite(limit) || limit <= 0) return undefined;
  const perDirection = Math.max(1, Math.floor(limit / 2));
  return [
    ...CURRENT_CORPUS.cases.filter((item) => item.direction === "ar→de").slice(0, perDirection),
    ...CURRENT_CORPUS.cases.filter((item) => item.direction === "de→ar").slice(0, perDirection),
  ];
}

function configuredConfigs(): ConfigId[] | undefined {
  const raw = process.env["EVAL_CONFIGS"];
  if (!raw) return undefined;
  return raw.split(",").map((value) => value.trim()) as ConfigId[];
}

it.skipIf(!enabled || !key)(
  "runs the controlled production vs deeper-reasoning evaluation on the frozen corpus",
  async () => {
    if (!key) throw new Error("DEEPSEEK_API_KEY is not configured; live evaluation cannot run.");
    const result = await runEvaluation({
      key,
      corpus: configuredCorpus(),
      configs: configuredConfigs(),
      judge: process.env["EVAL_SKIP_JUDGE"] !== "1",
      probes: process.env["EVAL_SKIP_PROBES"] !== "1",
      fixturePath: process.env["EVAL_WRITE_FIXTURE"] === "1" ? fixturePath : undefined,
    });
    const summary = result.summary;
    // Structural evidence that the run happened; quality thresholds belong to the report.
    const fullRuns = configuredCorpus() === undefined;
    if (fullRuns) expect(summary.caseCount).toBeGreaterThanOrEqual(40);
    expect(summary.configs.length).toBe(configuredConfigs()?.length ?? 3);
    for (const config of summary.configs) {
      expect(config.overall.cases, `${config.configId} case count`).toBe(summary.caseCount);
      expect(
        config.overall.providerOk,
        `${config.configId} provider failures`,
      ).toBeGreaterThanOrEqual(Math.floor(summary.caseCount * 0.9));
    }
    expect(fs.existsSync(path.join(result.artifactDir, "results.json"))).toBe(true);
    expect(fs.existsSync(path.join(result.artifactDir, "summary.md"))).toBe(true);
  },
  900_000,
);

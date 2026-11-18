import fs from "node:fs";
import path from "node:path";
import { CURRENT_CORPUS, validateCorpus } from "./corpus";
import type { EvalCase } from "./corpus/types";
import { scoreCase, type CaseScore } from "./scoring";
import {
  EVAL_MODEL,
  JUDGE_MODEL,
  configFor,
  judgeCase,
  requestForCase,
  streamLiveCase,
  translateCase,
  type CallResult,
  type ConfigId,
  type JudgeRun,
  type Usage,
} from "./providers";
import {
  probeAnalysis,
  probeCapabilities,
  probeLongInput,
  probeRepair,
  type AnalysisProbe,
  type CapabilityProbe,
  type LongInputProbe,
  type RepairProbe,
} from "./probes";
import {
  CONTEXT_WINDOW_TOKENS,
  MAX_OUTPUT_TOKENS,
  assertContextFits,
  capabilityRequest,
} from "../../src/lib/translation/providers/capabilities";
import { outputTokenBudget } from "../../src/lib/translation/budget";

export const CONFIG_IDS: ConfigId[] = ["production-full", "reasoning-high", "reasoning-max"];

export interface RunOptions {
  key: string;
  /** Worker pool size; bounded on purpose (documented account concurrency is 2500). */
  concurrency?: number;
  corpus?: EvalCase[];
  configs?: ConfigId[];
  /** Whether to run the independent judge (secondary signal). */
  judge?: boolean;
  /** Whether to run the live capability/budget probes. */
  probes?: boolean;
  /** Directory for gitignored run artefacts; defaults to artifacts/eval/<runId>. */
  artifactDir?: string;
  /** Write a committed baseline fixture here (only for a deliberate baseline run). */
  fixturePath?: string;
  /** Print progress (defaults to true). */
  progress?: boolean;
}

export interface CaseRecord {
  configId: ConfigId;
  caseId: string;
  direction: EvalCase["direction"];
  category: EvalCase["category"];
  ok: boolean;
  latencyMs: number;
  status: number | null;
  finishReason: string | null;
  completionError: string | null;
  parseError: string | null;
  error: string | null;
  usage: Usage;
  translationChars: number | null;
  /** Kept for the judge and the gitignored artefact; never written to the committed fixture. */
  text: string | null;
  isAmbiguous: boolean | null;
  score: CaseScore | null;
  judge: JudgeRun | null;
}

export interface DirectionSummary {
  cases: number;
  providerOk: number;
  deterministicPass: number;
  passRate: number;
  /**
   * Cases whose only failure is the verifier's date/number separator mismatch (a correct
   * 12.03.2026 is reported as missing "12, 03, 2026"). Reported separately so a known
   * verifier limitation never masquerades as a model quality difference.
   */
  suspectedVerifyFalsePositive: number;
  passExcludingSuspectedVerifyFalsePositive: number;
  latencyP50Ms: number | null;
  latencyP90Ms: number | null;
  completionTokensP50: number | null;
  reasoningTokensP50: number | null;
  verifyIssueCases: number;
}

export interface ConfigSummary {
  configId: ConfigId;
  label: string;
  detail: string;
  overall: DirectionSummary;
  byDirection: Partial<Record<EvalCase["direction"], DirectionSummary>>;
  judge: JudgeSummary | null;
}

export interface JudgeSummary {
  casesJudged: number;
  meanConceptScore: number | null;
  fields: Record<"meaning" | "naturalness" | "register" | "facts" | "noInvention", number | null>;
  /** Paired against production-full: positive means the deeper config scored higher. */
  deltaVsProduction: {
    mean: number | null;
    wins: number;
    losses: number;
    ties: number;
  };
}

export interface LiveProbeSummary {
  cases: number;
  ttftP50Ms: number | null;
  ttftP90Ms: number | null;
  totalP50Ms: number | null;
  reasoningTokensTotal: number;
  okCases: number;
}

export interface BudgetAudit {
  supportedSourceChars: number;
  contextWindowTokens: number;
  maxOutputTokens: number;
  profilesAtMaxInput: Record<
    string,
    { maxTokens: number; structured: boolean; fitsContext: boolean }
  >;
  plainAnswerBudgetAtMaxInput: { structured: number; live: number };
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  corpusVersion: string;
  caseCount: number;
  model: string;
  judgeModel: string;
  configs: ConfigSummary[];
  liveProbe: LiveProbeSummary | null;
  capabilities: CapabilityProbe | null;
  budget: BudgetAudit;
  longInput: LongInputProbe | null;
  repair: RepairProbe | null;
  analysis: AnalysisProbe | null;
  recommendation: Recommendation;
}

export interface Recommendation {
  keepProductionFull: boolean;
  comparedTo: ConfigId;
  deterministicPassDelta: number;
  judgeMeanDelta: number | null;
  latencyMultiplier: number | null;
  timeouts: number;
  rationale: string;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
    : (sorted[mid] ?? null);
};

const p90 = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? null;
};

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

function summarize(records: CaseRecord[]): DirectionSummary {
  const okRecords = records.filter((record) => record.ok);
  const passed = records.filter((record) => record.score?.pass === true).length;
  const reasoning = okRecords
    .map((record) => record.usage.reasoning_tokens)
    .filter((value): value is number => value !== null && value > 0);
  const suspected = records.filter(
    (record) =>
      record.score !== null &&
      record.score.checks.facts &&
      record.score.verifyIssues.length > 0 &&
      record.score.verifyIssues.every((issue) => issue.startsWith("Numbers missing")),
  ).length;
  return {
    cases: records.length,
    providerOk: okRecords.length,
    deterministicPass: passed,
    passRate: records.length === 0 ? 0 : passed / records.length,
    suspectedVerifyFalsePositive: suspected,
    passExcludingSuspectedVerifyFalsePositive: passed + suspected,
    latencyP50Ms: median(okRecords.map((record) => record.latencyMs)),
    latencyP90Ms: p90(okRecords.map((record) => record.latencyMs)),
    completionTokensP50: median(
      okRecords
        .map((record) => record.usage.completion_tokens)
        .filter((value): value is number => value !== null),
    ),
    reasoningTokensP50: median(reasoning),
    verifyIssueCases: records.filter((record) => (record.score?.verifyIssues.length ?? 0) > 0)
      .length,
  };
}

export function judgeSummary(records: CaseRecord[], production: CaseRecord[]): JudgeSummary | null {
  const scored = records.filter((record) => record.judge?.scores);
  if (scored.length === 0) return null;
  const fields = ["meaning", "naturalness", "register", "facts", "noInvention"] as const;
  const perCase = new Map<string, number>();
  const fieldMeans: JudgeSummary["fields"] = {
    meaning: null,
    naturalness: null,
    register: null,
    facts: null,
    noInvention: null,
  };
  for (const field of fields) {
    fieldMeans[field] = mean(scored.map((record) => record.judge!.scores![field])) as number | null;
  }
  for (const record of scored) {
    const scores = record.judge!.scores!;
    perCase.set(
      record.caseId,
      fields.reduce((sum, field) => sum + scores[field], 0) / fields.length,
    );
  }
  const productionScores = new Map<string, number>();
  for (const record of production) {
    const scores = record.judge?.scores;
    if (!scores) continue;
    productionScores.set(
      record.caseId,
      fields.reduce((sum, field) => sum + scores[field], 0) / fields.length,
    );
  }
  const deltas: number[] = [];
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const [caseId, score] of perCase) {
    const base = productionScores.get(caseId);
    if (base === undefined) continue;
    const delta = score - base;
    deltas.push(delta);
    if (delta > 0.01) wins += 1;
    else if (delta < -0.01) losses += 1;
    else ties += 1;
  }
  return {
    casesJudged: scored.length,
    meanConceptScore: mean([...perCase.values()]),
    fields: fieldMeans,
    deltaVsProduction: { mean: mean(deltas), wins, losses, ties },
  };
}

function budgetAudit(): BudgetAudit {
  const profiles: BudgetAudit["profilesAtMaxInput"] = {};
  for (const profile of ["live", "full", "repair", "analysis"] as const) {
    const capability = capabilityRequest(profile, 5_000);
    let fitsContext = true;
    try {
      assertContextFits(5_000, capability.max_tokens);
    } catch {
      fitsContext = false;
    }
    profiles[profile] = {
      maxTokens: capability.max_tokens,
      structured: capability.response_format !== undefined,
      fitsContext,
    };
  }
  return {
    supportedSourceChars: 5_000,
    contextWindowTokens: CONTEXT_WINDOW_TOKENS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    profilesAtMaxInput: profiles,
    plainAnswerBudgetAtMaxInput: {
      structured: outputTokenBudget(5_000, true),
      live: outputTokenBudget(5_000, false),
    },
  };
}

function recommendationFor(configs: ConfigSummary[]): Recommendation {
  const production = configs.find((config) => config.configId === "production-full");
  const deeper = configs.find((config) => config.configId === "reasoning-high");
  if (!production || !deeper)
    return {
      keepProductionFull: true,
      comparedTo: "reasoning-high",
      deterministicPassDelta: 0,
      judgeMeanDelta: null,
      latencyMultiplier: null,
      timeouts: 0,
      rationale: "comparison incomplete; production profile unchanged",
    };
  const deterministicPassDelta = deeper.overall.passRate - production.overall.passRate;
  const judgeMeanDelta = deeper.judge?.deltaVsProduction.mean ?? null;
  const latencyMultiplier =
    production.overall.latencyP50Ms !== null &&
    production.overall.latencyP50Ms > 0 &&
    deeper.overall.latencyP50Ms !== null
      ? deeper.overall.latencyP50Ms / production.overall.latencyP50Ms
      : null;
  const timeouts = deeper.overall.cases - deeper.overall.providerOk;
  const adopt =
    deterministicPassDelta >= 0.05 &&
    (judgeMeanDelta ?? 0) >= 0.25 &&
    (latencyMultiplier ?? Infinity) <= 2.0 &&
    timeouts === 0;
  const rationale = adopt
    ? "deeper reasoning clears the pre-declared bar (>=5pp deterministic, >=0.25 judge mean, <=2x latency, no failures); change the production full profile"
    : "deeper reasoning does not clear the pre-declared bar (>=5pp deterministic, >=0.25 judge mean, <=2x latency, no failures); keep the production full profile";
  return {
    keepProductionFull: !adopt,
    comparedTo: "reasoning-high",
    deterministicPassDelta,
    judgeMeanDelta,
    latencyMultiplier,
    timeouts,
    rationale,
  };
}

async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) break;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}

const now = () => new Date().toISOString();

export async function runEvaluation(
  options: RunOptions,
): Promise<{ summary: RunSummary; records: CaseRecord[]; artifactDir: string }> {
  const corpus = options.corpus ?? CURRENT_CORPUS.cases;
  // The frozen corpus is always validated as a whole; a bounded smoke run is a subset of it.
  const problems = validateCorpus(CURRENT_CORPUS);
  if (problems.length > 0) throw new Error(`corpus is invalid: ${problems.join("; ")}`);
  if (corpus.length === 0) throw new Error("no evaluation cases selected");
  const configsToRun = options.configs ?? CONFIG_IDS;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 6));
  const startedAt = now();
  const runId = `eval-${startedAt.replace(/[:.]/g, "-")}`;
  const artifactDir = options.artifactDir ?? path.join("artifacts", "eval", runId);
  const progress = options.progress !== false;
  const records: CaseRecord[] = [];
  const configs: ConfigSummary[] = [];

  for (const configId of configsToRun) {
    process.stdout.write(
      `[${configId}] starting ${corpus.length} cases (concurrency ${concurrency})\n`,
    );
    let done = 0;
    const rows = await pool(corpus, concurrency, async (testCase) => {
      const config = configFor(configId, testCase.source.length);
      const run = await translateCase(options.key, testCase, configId);
      const score = run.result ? scoreCase(testCase, requestForCase(testCase), run.result) : null;
      const call: CallResult = run.call;
      done += 1;
      if (progress && (done % 10 === 0 || done === corpus.length))
        process.stdout.write(`[${configId}] ${done}/${corpus.length} cases\n`);
      return {
        configId,
        caseId: testCase.id,
        direction: testCase.direction,
        category: testCase.category,
        ok: call.ok && run.result !== null,
        latencyMs: call.latencyMs,
        status: call.status,
        finishReason: call.finishReason,
        completionError: call.completionError,
        parseError: run.parseError,
        error: call.error,
        usage: call.usage,
        translationChars: run.result ? run.result.translation.length : null,
        text: run.result ? run.result.translation : null,
        isAmbiguous: run.result ? run.result.isAmbiguous : null,
        score,
        judge: null,
      } satisfies CaseRecord;
    });
    const config = configFor(configId, 5_000);
    const overall = summarize(rows as CaseRecord[]);
    const byDirection: ConfigSummary["byDirection"] = {};
    for (const direction of ["ar→de", "de→ar"] as const) {
      byDirection[direction] = summarize(
        (rows as CaseRecord[]).filter((row) => row.direction === direction),
      );
    }
    configs.push({
      configId,
      label: config.label,
      detail: config.detail,
      overall,
      byDirection,
      judge: null,
    });
    records.push(...(rows as CaseRecord[]));
  }

  if (options.judge !== false) {
    const production = records.filter((record) => record.configId === "production-full");
    for (const config of configs) {
      const rows = records.filter((record) => record.configId === config.configId);
      let judged = 0;
      await pool(rows, concurrency, async (record) => {
        const testCase = corpus.find((item) => item.id === record.caseId)!;
        const row = records.find(
          (item) => item.configId === config.configId && item.caseId === record.caseId,
        )!;
        const translation = row.text;
        if (!row.ok || !translation) return;
        const judgedRow = await judgeCase(options.key, testCase, translation);
        row.judge = judgedRow;
        judged += 1;
        if (progress && judged % 15 === 0)
          process.stdout.write(`[judge ${config.configId}] ${judged} cases\n`);
      });
      config.judge = judgeSummary(rows, production);
    }
  }

  const budget = budgetAudit();
  let capabilities: CapabilityProbe | null = null;
  let longInput: LongInputProbe | null = null;
  let repair: RepairProbe | null = null;
  let analysis: AnalysisProbe | null = null;
  let liveProbe: LiveProbeSummary | null = null;
  if (options.probes !== false) {
    process.stdout.write("[probes] capabilities\n");
    capabilities = await probeCapabilities(options.key);
    process.stdout.write("[probes] 5,000-character structured answer\n");
    longInput = await probeLongInput(options.key);
    if (longInput.translation) {
      process.stdout.write("[probes] repair on the long answer\n");
      repair = await probeRepair(options.key, longInput.translation);
    }
    process.stdout.write("[probes] analysis profile\n");
    analysis = await probeAnalysis(options.key);
    process.stdout.write("[probes] live streaming first-byte latency\n");
    const picks = [
      ...corpus.filter((item) => item.direction === "ar→de").slice(0, 4),
      ...corpus.filter((item) => item.direction === "de→ar").slice(0, 4),
    ];
    const streams = await pool(picks, 2, async (testCase) => streamLiveCase(options.key, testCase));
    liveProbe = {
      cases: streams.length,
      ttftP50Ms: median(
        streams.map((run) => run.ttftMs).filter((value): value is number => value !== null),
      ),
      ttftP90Ms: p90(
        streams.map((run) => run.ttftMs).filter((value): value is number => value !== null),
      ),
      totalP50Ms: median(streams.map((run) => run.totalMs)),
      reasoningTokensTotal: streams.reduce(
        (sum, run) => sum + (run.usage.reasoning_tokens ?? 0),
        0,
      ),
      okCases: streams.filter((run) => run.ok).length,
    };
  }

  const summary: RunSummary = {
    runId,
    startedAt,
    finishedAt: now(),
    corpusVersion: CURRENT_CORPUS.version,
    caseCount: corpus.length,
    model: EVAL_MODEL,
    judgeModel: JUDGE_MODEL,
    configs,
    liveProbe,
    capabilities,
    budget,
    longInput,
    repair,
    analysis,
    recommendation: recommendationFor(configs),
  };

  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, "results.json"),
    JSON.stringify({ summary, records }, null, 2),
  );
  fs.writeFileSync(path.join(artifactDir, "summary.md"), renderSummary(summary));
  if (options.fixturePath) {
    fs.mkdirSync(path.dirname(options.fixturePath), { recursive: true });
    fs.writeFileSync(
      options.fixturePath,
      JSON.stringify(fixtureOf(summary, records), null, 2) + "\n",
    );
  }
  if (progress) process.stdout.write(`\n${renderSummary(summary)}\n`);
  return { summary, records, artifactDir };
}

function fixtureOf(summary: RunSummary, records: CaseRecord[]) {
  return {
    kind: "translation-eval-baseline",
    corpusVersion: summary.corpusVersion,
    caseCount: summary.caseCount,
    model: summary.model,
    judgeModel: summary.judgeModel,
    generatedAt: summary.startedAt,
    runId: summary.runId,
    configs: summary.configs.map((config) => ({
      configId: config.configId,
      label: config.label,
      detail: config.detail,
      overall: config.overall,
      byDirection: config.byDirection,
      judge: config.judge,
    })),
    cases: records.map((record) => ({
      configId: record.configId,
      caseId: record.caseId,
      direction: record.direction,
      category: record.category,
      ok: record.ok,
      pass: record.score?.pass ?? false,
      checks: record.score?.checks ?? null,
      verifyIssues: record.score?.verifyIssues ?? [],
      latencyMs: record.latencyMs,
      usage: record.usage,
      judgeScores: record.judge?.scores ?? null,
      judgeModel: record.judge?.model ?? null,
    })),
    probes: {
      capabilities: summary.capabilities,
      budget: summary.budget,
      // Raw model output stays in the gitignored run artefact; the committed fixture
      // carries measurements, never generated text.
      longInput: summary.longInput ? { ...summary.longInput, translation: null } : null,
      repair: summary.repair,
      analysis: summary.analysis,
      liveProbe: summary.liveProbe,
    },
    recommendation: summary.recommendation,
  };
}

function renderSummary(summary: RunSummary): string {
  const lines: string[] = [];
  lines.push(`# Translation evaluation — ${summary.runId}`);
  lines.push("");
  lines.push(
    `- corpus: ${summary.corpusVersion} · ${summary.caseCount} cases (22 ar→de / 22 de→ar expected)`,
  );
  lines.push(`- writer: ${summary.model} · judge (secondary): ${summary.judgeModel}`);
  lines.push(`- started: ${summary.startedAt} · finished: ${summary.finishedAt}`);
  lines.push("");
  lines.push("## Deterministic results");
  lines.push("");
  lines.push(
    "| config | dir | cases | provider ok | deterministic pass | pass rate | pass rate excl. date-verify FP | latency p50 / p90 ms | completion tokens p50 | reasoning tokens p50 | verify-issue cases |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const config of summary.configs) {
    const rows: [string, DirectionSummary][] = [
      ["all", config.overall],
      ...Object.entries(config.byDirection).map(
        ([direction, value]) => [direction, value] as [string, DirectionSummary],
      ),
    ];
    for (const [direction, row] of rows) {
      lines.push(
        `| ${config.configId} | ${direction} | ${row.cases} | ${row.providerOk} | ${row.deterministicPass} | ${(row.passRate * 100).toFixed(1)}% | ${((row.passExcludingSuspectedVerifyFalsePositive / row.cases) * 100).toFixed(1)}% | ${row.latencyP50Ms ?? "-"} / ${row.latencyP90Ms ?? "-"} | ${row.completionTokensP50 ?? "-"} | ${row.reasoningTokensP50 ?? "-"} | ${row.verifyIssueCases} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Independent judge (secondary signal only)");
  lines.push("");
  lines.push(
    "| config | judged | mean concept score | meaning | naturalness | register | facts | noInvention | delta vs production | wins/losses/ties |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const config of summary.configs) {
    const judge = config.judge;
    if (!judge) {
      lines.push(`| ${config.configId} | 0 | - | - | - | - | - | - | - | - |`);
      continue;
    }
    const f = judge.fields;
    const fmt = (value: number | null) => (value === null ? "-" : value.toFixed(2));
    lines.push(
      `| ${config.configId} | ${judge.casesJudged} | ${fmt(judge.meanConceptScore)} | ${fmt(f.meaning)} | ${fmt(f.naturalness)} | ${fmt(f.register)} | ${fmt(f.facts)} | ${fmt(f.noInvention)} | ${fmt(judge.deltaVsProduction.mean)} | ${judge.deltaVsProduction.wins}/${judge.deltaVsProduction.losses}/${judge.deltaVsProduction.ties} |`,
    );
  }
  lines.push("");
  if (summary.capabilities) {
    const c = summary.capabilities;
    lines.push("## Documented capability probe (live, deployed model)");
    lines.push("");
    lines.push(
      `- models endpoint: ${c.models.ids.join(", ") || "unavailable"} (HTTP ${c.models.status ?? "-"})`,
    );
    lines.push(
      `- max_tokens 393,216 accepted: ${c.maxTokensAccepted.status === 200} · 393,217 rejected: ${c.maxTokensRejected.status === 400}`,
    );
    lines.push(
      `- thinking default on (reasoning tokens at max_tokens 8): ${c.thinkingDefault.reasoningTokens ?? "null"} · thinking disabled reasoning tokens: ${c.thinkingDisabled.reasoningTokens ?? "null"}`,
    );
    lines.push(
      `- JSON mode valid JSON: ${c.jsonMode.validJson} · stream [DONE]: ${c.stream.doneMarker}, usage on last chunk: ${c.stream.usageOnLastChunk}`,
    );
    lines.push(`- client abort observed after ${c.clientAbort.firstByteMs ?? "-"} ms`);
    lines.push("");
  }
  if (summary.liveProbe) {
    const live = summary.liveProbe;
    lines.push("## Live path (streaming, thinking disabled)");
    lines.push("");
    lines.push(
      `- ${live.okCases}/${live.cases} ok · first byte p50 ${live.ttftP50Ms ?? "-"} ms · p90 ${live.ttftP90Ms ?? "-"} ms · completion p50 ${live.totalP50Ms ?? "-"} ms · reasoning tokens total ${live.reasoningTokensTotal}`,
    );
    lines.push("");
  }
  if (summary.longInput || summary.repair || summary.analysis) {
    lines.push("## Budget probes (largest supported input, structured outputs)");
    lines.push("");
    if (summary.longInput) {
      const l = summary.longInput;
      lines.push(
        `- full, ${l.chars} chars → max_tokens ${l.maxTokens}, finish ${l.finish ?? "-"}, parse ok ${l.parseOk}, output ${l.outputChars ?? "-"} chars, completion tokens ${l.completionTokens ?? "-"}, verify issues ${l.verifyIssues.length}`,
      );
    }
    if (summary.repair) {
      const r = summary.repair;
      lines.push(
        `- repair → max_tokens ${r.maxTokens}, finish ${r.finish ?? "-"}, reasoning tokens ${r.reasoningTokens ?? "-"}, parse ok ${r.parseOk}, issues before ${r.issuesBefore.length}, after ${r.issuesAfter.length}`,
      );
    }
    if (summary.analysis) {
      const a = summary.analysis;
      lines.push(
        `- analysis → max_tokens ${a.maxTokens}, finish ${a.finish ?? "-"}, reasoning tokens ${a.reasoningTokens ?? "-"}, valid JSON ${a.validJson}`,
      );
    }
    lines.push("");
  }
  lines.push("## Recommendation (pre-declared thresholds, applied to measured data)");
  lines.push("");
  lines.push(`- keep production full profile: **${summary.recommendation.keepProductionFull}**`);
  lines.push(
    `- deterministic pass delta vs production: ${(summary.recommendation.deterministicPassDelta * 100).toFixed(1)} pp`,
  );
  lines.push(
    `- judge mean delta: ${summary.recommendation.judgeMeanDelta?.toFixed(2) ?? "-"} · latency multiplier: ${summary.recommendation.latencyMultiplier?.toFixed(2) ?? "-"} · failed deeper calls: ${summary.recommendation.timeouts}`,
  );
  lines.push(`- ${summary.recommendation.rationale}`);
  return lines.join("\n");
}

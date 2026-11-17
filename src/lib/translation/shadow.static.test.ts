import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const functionsSource = read("./shadow.functions.ts");
const modelSource = read("./shadow.ts");
const hookSource = read("./useShadow.ts");

/**
 * Static architecture guards. The shadow's prompt, parser, anchoring and windowing live
 * in one client-safe module, and the server function reaches a model only through the
 * provider-agnostic engine — otherwise a provider change would silently bypass the
 * analysis profile and the windowed analysis would exist twice.
 */
describe("shadow provider independence", () => {
  it("the server function reaches analysis only through engine.runAnalysis", () => {
    expect(functionsSource).not.toMatch(/providers\//);
    expect(functionsSource).not.toMatch(/deepseek\.server|opencode\.server|deepseekKey/);
    expect(functionsSource).toMatch(/await import\(["']\.\/engine\.server["']\)/);
    expect(functionsSource).toMatch(/runAnalysis\(/);
    // Still quiet background work: the enrichment budget, never the typing budget.
    expect(functionsSource).toMatch(/takeEnrichmentToken/);
    expect(functionsSource).toMatch(/sameOrigin/);
  });

  it("the prompt, parser, anchoring and windowing live in one client-safe module", () => {
    expect(modelSource).not.toMatch(/\.server["']/);
    expect(modelSource).not.toMatch(/providers\//);
    expect(modelSource).toMatch(/export const SHADOW_SYSTEM/);
    expect(modelSource).toMatch(/export function parseShadow/);
    expect(modelSource).toMatch(/export function shadowUserPrompt/);
    expect(modelSource).toMatch(/export function planShadowWindows/);
    expect(modelSource).toMatch(/export function readWindowShadowReply/);
    expect(modelSource).toMatch(/export function mergeWindowLosses/);
    expect(modelSource).toMatch(/export function anchorCandidates/);
  });

  it("the hook cache identity carries the version and every input", () => {
    expect(hookSource).toMatch(/const SHADOW_CACHE_VERSION = 2;/);
    const start = hookSource.indexOf("const key = JSON.stringify([");
    expect(start).toBeGreaterThan(-1);
    const key = hookSource.slice(start, hookSource.indexOf("]);", start));
    for (const field of [
      "SHADOW_CACHE_VERSION",
      "source",
      "target",
      "style",
      "dialect",
      "uiLocale",
      "normalized",
      "translation",
    ]) {
      expect(key).toContain(field);
    }
  });
});

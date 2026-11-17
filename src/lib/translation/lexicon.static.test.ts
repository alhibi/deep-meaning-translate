import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const functionsSource = read("./lexicon.functions.ts");
const modelSource = read("./lexicon.ts");
const hookSource = read("./useLexicon.ts");

/**
 * Static architecture guards. These are cheap assertions about the module graph: the
 * lexicon surface must not grow a provider import, and the prompt/parser/ranking must stay
 * in one client-safe module so a schema change cannot update only half of the contract.
 */
describe("lexicon provider independence", () => {
  it("the server function reaches analysis only through engine.runAnalysis", () => {
    expect(functionsSource).not.toMatch(/providers\//);
    expect(functionsSource).not.toMatch(/deepseek\.server|opencode\.server|deepseekKey/);
    expect(functionsSource).toMatch(/await import\(["']\.\/engine\.server["']\)/);
    expect(functionsSource).toMatch(/runAnalysis\(/);
    // The lookup still spends the dictionary/shadow enrichment budget, never typing.
    expect(functionsSource).toMatch(/takeEnrichmentToken/);
  });

  it("the prompt, parser and gate live in one client-safe module", () => {
    expect(modelSource).not.toMatch(/\.server["']/);
    expect(modelSource).not.toMatch(/providers\//);
    expect(modelSource).toMatch(/export const LEXICON_SYSTEM/);
    expect(modelSource).toMatch(/export function parseLexicon/);
    expect(modelSource).toMatch(/export function lexiconUserPrompt/);
  });

  it("the hook cache identity carries the version and every ranking input", () => {
    expect(hookSource).toMatch(/const LEXICON_CACHE_VERSION = 2;/);
    const start = hookSource.indexOf("const key = JSON.stringify([");
    expect(start).toBeGreaterThan(-1);
    const key = hookSource.slice(start, hookSource.indexOf("]);", start));
    for (const field of [
      "LEXICON_CACHE_VERSION",
      "source",
      "target",
      "style",
      "dialect",
      "uiLocale",
      "normalized",
      "translation",
      "sentence",
    ]) {
      expect(key).toContain(field);
    }
  });
});

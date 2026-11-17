import fs from "node:fs";
import path from "node:path";

/**
 * Server-side only: the DeepSeek key is read from the environment or the repo .env file.
 * It is never printed, never stored in an artefact and never sent to the browser bundle.
 */
export function readDeepSeekKey(cwd = process.cwd()): string | null {
  const fromEnv = process.env["DEEPSEEK_API_KEY"]?.trim();
  if (fromEnv) return fromEnv;
  try {
    const text = fs.readFileSync(path.join(cwd, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      if (match[1] !== "DEEPSEEK_API_KEY") continue;
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      return value.length > 0 ? value : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Only a truthiness check for logs/artefacts: the value never leaves this module. */
export function deepSeekKeyPresent(cwd = process.cwd()): boolean {
  return readDeepSeekKey(cwd) !== null;
}

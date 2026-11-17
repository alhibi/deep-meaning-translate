import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Configuration for the live provider evaluation, kept out of the default test gate on
// purpose: these files make paid DeepSeek calls and are run by hand with a real key.
//   npx vitest run --config tests/eval/eval.config.ts
// The repository gate (npm run verify) uses vitest.config.ts, whose include pattern is
// src/**/*.test.{ts,tsx}; nothing here can run inside it by accident.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/eval/**/*.live.test.ts"],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    fileParallelism: false,
  },
});

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// A separate runner for tests/perf. The product vitest config only collects
// src/**/*.test.* files; the performance gate and its fixtures are deliberately not part
// of the app unit suite (they do not import product code except for the pure validators
// named in each test). Run:
//   npx vitest run --config tests/perf/vitest.config.ts
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/perf/**/*.test.ts"],
  },
});

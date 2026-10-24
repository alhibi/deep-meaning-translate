import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Standalone test config: keeps the app's Vite plugins (SSR, PWA) out of unit tests.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    // A shared jsdom is created once per worker instead of once per file: the suite runs
    // several times faster with no loss of isolation between tests inside a file.
    pool: "vmThreads",
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/**/*.test.*", "src/test/**", "src/routeTree.gen.ts"],
      // Floors, not targets: they stop silent regression, and are ratcheted up as the
      // untested surfaces (routes, stats UI, speech) gain tests.
      thresholds: {
        lines: 45,
        statements: 43,
        functions: 38,
        branches: 36,
      },
    },
  },
});

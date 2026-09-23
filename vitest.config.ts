import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Standalone test config: keeps the app's Vite plugins (SSR, PWA) out of unit tests.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});

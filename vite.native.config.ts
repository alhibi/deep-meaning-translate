/**
 * The Android app's own build. It is deliberately separate from `vite.config.ts`:
 * the web target emits a Cloudflare Worker with SSR, server functions and a service
 * worker, none of which can live inside an APK.
 *
 * This target produces a client-only shell (SPA) whose assets are packaged locally.
 * `npm run build` is untouched, so both releases stay independent.
 */
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const apiBase = process.env["NATIVE_API_BASE"] ?? "https://fluently.today";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    spa: {
      enabled: true,
      maskPath: "/",
      prerender: {
        enabled: true,
        outputPath: "/index",
        crawlLinks: false,
        retryCount: 0,
      },
    },
  },
  vite: {
    define: {
      // Compiled in, validated at runtime (`src/lib/native/config.ts`).
      "import.meta.env.VITE_NATIVE_API_BASE": JSON.stringify(apiBase),
    },
    build: {
      // Devices keep their system WebView for years. The web target may assume a current
      // browser; the installed app must parse on Android 7-era WebViews too.
      target: "es2019",
      cssTarget: "chrome80",
    },
  },
});

/**
 * The Android app's own build. It is deliberately separate from `vite.config.ts`:
 * the web target emits a Cloudflare Worker with SSR, server functions and a service
 * worker, none of which can live inside an APK.
 *
 * This target produces a client-only shell (SPA) whose assets are packaged locally.
 * `npm run build` is untouched, so both releases stay independent.
 */
import { readFileSync } from "node:fs";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const apiBase = process.env["NATIVE_API_BASE"] ?? "https://fluently.today";
const appVersion = (
  JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

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
      // The prerendered native shell must match the client's first render. The client
      // cannot show the translator before the bridge snapshot is applied, so the native
      // build prerenders the boot cover instead of the translator; without this the
      // hydration tree differed and React threw error #418, discarding the server HTML
      // on every cold start. The web build never defines this flag.
      "import.meta.env.VITE_NATIVE_SHELL": JSON.stringify("1"),
      // A backup envelope should say which build wrote it (DataControls reads this).
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
    },
    build: {
      // Devices keep their system WebView for years. The web target may assume a current
      // browser; the installed app must parse on Android 7-era WebViews too.
      target: "es2019",
      cssTarget: "chrome80",
    },
  },
});

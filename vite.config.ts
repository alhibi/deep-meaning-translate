// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        strategies: "generateSW",
        registerType: "autoUpdate",
        injectRegister: null, // src/lib/pwa.ts is the only registrar
        manifest: false, // served from public/manifest.webmanifest
        filename: "sw.js",
        outDir: ".output/public", // the deployed client root — sw.js must live where the server serves it
        devOptions: { enabled: false },
        workbox: {
          globPatterns: ["**/*.{js,css,woff2,png,svg,ico,webmanifest,html}"],
          // Disable the plugin default ("index.html") explicitly. A NavigationRoute is registered
          // before the NetworkFirst document route and answers every navigation from one URL,
          // online or not; "index.html" is not even precached, so its registration also throws
          // and drops the routes after it (F15).
          navigateFallback: null,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              // App shell HTML: try the network first. No short timeout — a slow but online
              // first visit must not be shown as offline. The fallback is used only when the
              // fetch actually fails and no cached document exists.
              urlPattern: ({ request, url }) =>
                request.mode === "navigate" && !url.pathname.startsWith("/~oauth"),
              handler: "NetworkFirst",
              options: {
                cacheName: "lingua-shell",
                expiration: { maxEntries: 4 },
                precacheFallback: { fallbackURL: "/offline.html" },
              },
            },
            {
              // Hashed build assets are immutable: cache once, serve instantly (incl. offline).
              urlPattern: ({ url, sameOrigin }) =>
                sameOrigin && url.pathname.startsWith("/assets/"),
              handler: "CacheFirst",
              options: { cacheName: "lingua-assets", expiration: { maxEntries: 80 } },
            },
            // Translation requests (/_serverFn) are never cached.
          ],
        },
      }),
    ],
  },
});

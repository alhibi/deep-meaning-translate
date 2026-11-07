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
          navigateFallback: "/offline.html", // first visit with no connection still shows the brand, not a browser error
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              // App shell HTML: always try the network, fall back to last good copy offline.
              urlPattern: ({ request, url }) =>
                request.mode === "navigate" && !url.pathname.startsWith("/~oauth"),
              handler: "NetworkFirst",
              options: {
                cacheName: "lingua-shell",
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 4 },
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

#!/usr/bin/env node
/**
 * Copy the client-only SPA build into `android-web`, the folder Capacitor packages.
 *
 * Only public, app-owned assets are copied. The web deployment's `_headers` and the
 * service worker (if a build ever emits one) are deliberately excluded: a worker inside
 * the APK could only serve an older shell over a newer package, and HTTP headers are the
 * Worker's job, not the WebView's.
 */
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, ".output", "public");
const target = path.join(root, "android-web");
const EXCLUDED = new Set(["_headers", "sw.js", "manifest.webmanifest", "offline.html"]);

if (!existsSync(path.join(source, "index.html"))) {
  console.error("prepare-native-web: build the SPA first (vite.native.config.ts).");
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, {
  recursive: true,
  filter: (src) => !EXCLUDED.has(path.basename(src)),
});

const files = await readdir(target);
const index = await stat(path.join(target, "index.html"));
console.log(
  `prepare-native-web: ${files.length} entries, index.html ${index.size} bytes → android-web/`,
);

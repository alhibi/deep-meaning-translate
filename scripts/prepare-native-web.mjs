#!/usr/bin/env node
/**
 * Copy the client-only SPA build into `android-web`, the folder Capacitor packages.
 *
 * Only public, app-owned assets are copied. The web deployment's `_headers` and the
 * service worker (if a build ever emits one) are deliberately excluded: a worker inside
 * the APK could only serve an older shell over a newer package, and HTTP headers are the
 * Worker's job, not the WebView's.
 *
 * A meta Content-Security-Policy is injected here because there is no HTTP header layer
 * inside the WebView. It is a backstop, not a substitute for the bridge's origin gate: the
 * shell only loads its own bundled assets, talks to the product Worker, and opens the
 * dictation WebSocket. Everything else (remote scripts, objects, frames, cross-origin
 * forms) is refused, so a hypothetical XSS has no egress (A5-14).
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, ".output", "public");
const target = path.join(root, "android-web");
const EXCLUDED = new Set(["_headers", "sw.js", "manifest.webmanifest", "offline.html"]);

/** The native API base is compiled in through the same env var the app validates. */
function apiOrigin() {
  const raw = process.env.NATIVE_API_BASE ?? "https://fluently.today";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "10.0.2.2"))
      throw new Error("invalid base");
    return url.origin;
  } catch {
    return "https://fluently.today";
  }
}
const API_ORIGIN = apiOrigin();

const CSP = [
  "default-src 'self'",
  // Boot scripts and the router's inline hydration payload require inline script.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  // AudioWorklet for dictation is created from a blob.
  "worker-src 'self' blob:",
  // API_ORIGIN is fluently.today by default; api.deepseek.com is used only by the optional
  // personal-key (BYOK) mode, which never sends the key to our Worker.
  `connect-src 'self' ${API_ORIGIN} https://api.deepseek.com wss://streaming.assemblyai.com wss://api.assemblyai.com`,
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

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

const indexPath = path.join(target, "index.html");
const html = await readFile(indexPath, "utf8");
if (!html.includes("<head>")) {
  console.error("prepare-native-web: index.html has no <head>; cannot inject the CSP.");
  process.exit(1);
}
const withCsp = html.replace(
  "<head>",
  `<head><meta http-equiv="Content-Security-Policy" content="${CSP}">`,
);
await writeFile(indexPath, withCsp);
if (!withCsp.includes('http-equiv="Content-Security-Policy"')) {
  console.error("prepare-native-web: the CSP was not injected.");
  process.exit(1);
}

const files = await readdir(target);
const index = await stat(indexPath);
console.log(
  `prepare-native-web: ${files.length} entries, index.html ${index.size} bytes → android-web/`,
);

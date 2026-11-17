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
  // Same exact-host list as the web CSP (see src/lib/culture/media-hosts.json): remote
  // museum images are shown only from their own origin, never from an arbitrary one.
  "img-src 'self' data: blob: https://images.metmuseum.org",
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

/**
 * CSS lowering guard.
 *
 * The native target compiles CSS for a Chrome 80 WebView, and Lightning CSS lowers
 * logical properties for it. A logical property inside `@keyframes` is lowered by
 * hoisting the physical left/right declaration OUT of the keyframe and scoping it to the
 * next rule in the sheet. One dead keyframe once did exactly that to `.composer-editor`
 * and pushed the whole editing box — and therefore the native caret — hundreds of pixels
 * off its field in the installed app only. The source no longer uses logical properties
 * inside keyframes, and this assertion makes the artefact a build failure instead of a
 * device-only visual bug.
 */
async function assertCssLoweringSafe() {
  const assets = path.join(target, "assets");
  const names = existsSync(assets) ? await readdir(assets) : [];
  const sheets = names.filter((name) => name.endsWith(".css"));
  if (!sheets.length) {
    console.error("prepare-native-web: no CSS asset found; the guard cannot run.");
    process.exit(1);
  }
  for (const name of sheets) {
    const css = await readFile(path.join(assets, name), "utf8");
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim();
      if (!selector.includes(".composer-editor")) continue;
      // A focus marker pseudo-element may legitimately carry a physical edge.
      if (/::?after\b/.test(selector)) continue;
      if (!/(?:^|;)\s*(?:left|right)\s*:/.test(rule[2])) continue;
      console.error(
        `prepare-native-web: ${name} offsets the editor itself: "${selector.slice(0, 90)}". ` +
          "That is the Lightning CSS keyframe-lowering artefact that moves the composer " +
          "and its caret off the field; keep logical properties out of @keyframes.",
      );
      process.exit(1);
    }
  }
  console.log(
    `prepare-native-web: ${sheets.length} stylesheet(s) free of the composer offset artefact`,
  );
}

await assertCssLoweringSafe();

const files = await readdir(target);
const index = await stat(indexPath);
console.log(
  `prepare-native-web: ${files.length} entries, index.html ${index.size} bytes → android-web/`,
);

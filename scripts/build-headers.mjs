/**
 * Adds the deployment's security headers to the built `_headers` file.
 *
 * Runs after `vite build` because the platform writes its own `_headers` (asset
 * caching) as the last step of the build. Everything below is additive.
 *
 * CSP note: TanStack Start streams hydration data in inline <script> blocks whose
 * bytes differ per route, so a hash/nonce allowlist is not possible from here. Inline
 * script is therefore allowed, and every other vector is closed: no third-party
 * script, no plugins, no framing, no <base> hijack, no cross-origin form posts.
 * Moving hydration to a nonce requires server middleware issuing the nonce per
 * response — tracked in AUDIT.md as the next hardening step.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const file = join(new URL("../.output/public/", import.meta.url).pathname, "_headers");

const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY = [
  `  Content-Security-Policy: ${CSP}`,
  "  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload",
  "  X-Content-Type-Options: nosniff",
  "  X-Frame-Options: DENY",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Cross-Origin-Opener-Policy: same-origin",
  "  Permissions-Policy: camera=(), geolocation=(), payment=(), usb=(), microphone=(self), display-capture=()",
].join("\n");

const emitted = ["/*", "/assets/*", "/sw.js", "/manifest.webmanifest", "/stats"];
const existing = existsSync(file) ? await readFile(file, "utf8") : "";
// Keep whatever the platform emitted for paths we do not own; never duplicate a rule.
const kept = existing
  .split(/\n(?=\S)/)
  .map((block) => block.trim())
  .filter((block) => block && !emitted.includes(block.split("\n")[0].trim()));

const out = `/*
${SECURITY}

# Long-lived, immutable assets.
/assets/*
  Cache-Control: public, max-age=31536000, immutable

# The worker and the manifest must never be cached: they drive updates.
/sw.js
  Cache-Control: no-cache

/manifest.webmanifest
  Cache-Control: public, max-age=3600

# Private by design: nothing to index, nothing to embed.
/stats
  X-Robots-Tag: noindex
  Cache-Control: no-store
${kept.length ? `\n${kept.join("\n\n")}\n` : ""}`;

await writeFile(file, out);
console.log("security headers written →", file.replace(process.cwd(), "."));

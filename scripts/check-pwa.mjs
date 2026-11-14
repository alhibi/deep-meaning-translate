/**
 * Guards the PWA in CI: a service worker that precaches nothing is a service worker
 * that cannot open the app offline. Runs after `npm run build`.
 */
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const publicDir = join(root, ".output/public");
const failures = [];

const must = ["sw.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
for (const file of must) {
  if (!existsSync(join(publicDir, file))) failures.push(`missing ${file} in .output/public`);
}

if (!failures.length) {
  const sw = await readFile(join(publicDir, "sw.js"), "utf8");
  // F15 guard: a navigation fallback route answers every online navigation from one document.
  if (/createHandlerBoundToURL\(|NavigationRoute\(/.test(sw))
    failures.push(
      "service worker registers a navigation fallback route (F15: it would answer every navigation)",
    );
  if (!sw.includes("PrecacheFallbackPlugin"))
    failures.push(
      "service worker has no PrecacheFallbackPlugin; a failed navigation cannot reach /offline.html",
    );
  const urls = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
  if (urls.length < 6) failures.push(`service worker precaches only ${urls.length} entries`);
  if (!urls.some((u) => u.endsWith(".css"))) failures.push("no stylesheet in the precache list");
  if (!urls.some((u) => u.startsWith("assets/") && u.endsWith(".js")))
    failures.push("no JavaScript bundle in the precache list");

  const manifest = JSON.parse(await readFile(join(publicDir, "manifest.webmanifest"), "utf8"));
  if (!manifest.icons?.some((i) => i.purpose === "maskable"))
    failures.push("manifest has no maskable icon");
  if (!manifest.share_target) failures.push("manifest has no share_target");
  if (manifest.display !== "standalone") failures.push("manifest is not standalone");

  const assets = await readdir(join(publicDir, "assets"));
  const stray = assets.filter((f) => f.endsWith(".map"));
  if (stray.length) failures.push(`source maps shipped: ${stray.join(", ")}`);
  console.log(`PWA ok — ${urls.length} precached files, ${assets.length} hashed assets.`);
}

if (failures.length) {
  console.error("PWA check failed:");
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

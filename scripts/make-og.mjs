/**
 * Generates the social preview card (`public/og.png`, 1200×630) from the product's own
 * typefaces and colour tokens — no designer file to keep in sync, no third-party renderer.
 * Fonts come from the self-hosted fontsource packages (woff2 → ttf), so the card uses
 * exactly the faces the app ships.
 *
 *   npm run og
 *
 * Re-run whenever the wordmark, tagline or palette changes.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { decompress } from "wawoff2";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url).pathname;
const fontDir = (pkg, file) => join(root, "node_modules", pkg, "files", file);

const FACES = {
  geist: fontDir("@fontsource-variable/geist", "geist-latin-wght-normal.woff2"),
  serifItalic: fontDir("@fontsource/instrument-serif", "instrument-serif-latin-400-italic.woff2"),
  arabic: fontDir(
    "@fontsource/ibm-plex-sans-arabic",
    "ibm-plex-sans-arabic-arabic-600-normal.woff2",
  ),
  latin: fontDir("@fontsource/ibm-plex-sans-arabic", "ibm-plex-sans-arabic-latin-600-normal.woff2"),
};

const tmp = join(root, "node_modules/.cache/og");
await (await import("node:fs/promises")).mkdir(tmp, { recursive: true });

const fontFiles = [];
for (const [name, file] of Object.entries(FACES)) {
  try {
    const ttf = Buffer.from(await decompress(await readFile(file)));
    const out = join(tmp, `${name}.ttf`);
    await writeFile(out, ttf);
    fontFiles.push(out);
  } catch {
    // A missing subset only costs that line, never the whole card.
  }
}

const INK = "#f3efe8";
const CLAY = "#dd9169";
const QUIET = "#a7a19a";
const PAPER = "#12100f";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${PAPER}"/>
  <rect x="0.5" y="0.5" width="1199" height="629" fill="none" stroke="${INK}" stroke-opacity="0.08"/>

  <!-- signature mark: one clay diamond, exactly as in the app header -->
  <g transform="translate(84 92)">
    <rect x="0" y="0" width="14" height="14" rx="2" transform="rotate(45 7 7)" fill="${CLAY}"/>
  </g>

  <text x="112" y="108" font-family="Geist" font-size="34" font-weight="500" fill="${INK}" letter-spacing="-0.4">today</text>

  <text x="80" y="268" font-family="Geist" font-size="86" font-weight="500" fill="${INK}" letter-spacing="-3">Say it as you</text>
  <text x="80" y="360" font-family="Geist" font-size="86" font-weight="500" fill="${INK}" letter-spacing="-3">mean it.</text>

  <text x="80" y="470" font-family="Instrument Serif" font-size="46" font-style="italic" fill="${QUIET}">say it naturally.</text>

  <text x="80" y="548" font-family="IBM Plex Sans Arabic" font-size="34" font-weight="600" fill="${CLAY}">المعنى أولاً</text>
  <text x="80" y="592" font-family="Geist" font-size="19" font-weight="500" fill="${QUIET}" letter-spacing="0.14">ARABIC · GERMAN · EVERY OTHER LANGUAGE</text>

  <g transform="translate(1120 96)" opacity="0.9">
    <text x="0" y="0" font-family="Geist" font-size="16" font-weight="500" fill="${QUIET}" text-anchor="end" letter-spacing="1.4">FLUENTLY.TODAY</text>
  </g>
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
  font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Geist" },
})
  .render()
  .asPng();

await writeFile(join(root, "public/og.png"), png);
console.log(`og.png written — ${Math.round(png.length / 1024)} KB`);

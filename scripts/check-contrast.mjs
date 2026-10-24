#!/usr/bin/env node
/**
 * WCAG contrast gate for every theme.
 *
 * The app has three palettes and a lot of quiet text in each. "It looks fine" is not a
 * check, and a palette added later can silently drop a secondary label below AA. So the
 * pairs that carry meaning are listed here explicitly and computed from the real tokens
 * in `src/styles.css` — the same file the browser reads. Any pair under its required
 * ratio fails the build.
 *
 * Ratios required:
 *   4.5 — body text, secondary labels, quiet captions (WCAG AA, normal size)
 *   3.0 — large text and non-text UI that must be perceivable (AA, large / graphics)
 *
 * Run: node scripts/check-contrast.mjs
 */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

/** Extract the declarations of one selector block (`:root`, `html.light`, …). */
function blockFor(selector) {
  // Match the selector at line start, then take the balanced braces that follow.
  const start = css.search(
    new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`),
  );
  if (start < 0) throw new Error(`selector not found in styles.css: ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after ${selector}`);
}

function tokens(selector) {
  const out = {};
  for (const m of blockFor(selector).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/** Accept `#rgb`, `#rrggbb`, `rgb(r g b)` and `rgb(r g b / a%)`; ignore the rest. */
function toRgb(value) {
  const v = String(value).trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*\)$/i.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** `rgb(r g b / 16%)` → [colour, alpha], or null when there is no alpha channel. */
function toAlpha(value) {
  const m = /rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)%\s*\)/i.exec(
    String(value).trim(),
  );
  if (!m) return null;
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: Number(m[4]) / 100 };
}

/**
 * Resolve a token to a concrete colour, following `var()` indirection and compositing
 * any alpha channel over the surface it is actually drawn on.
 *
 * Both halves are needed to make this gate mean anything: `--ring` is defined as
 * `var(--signal)`, so without the indirection the focus indicator — the pair that
 * matters most — would be reported as unparsable. And `--border-strong` is
 * `rgb(243 239 232 / 14%)`; reading the channel values as an opaque colour would
 * report a hairline as near-white text and pass a value that is invisible on screen.
 */
function colorOf(value, theme, backdrop, depth = 0) {
  const raw = String(value ?? "").trim();
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.+))?\s*\)$/i.exec(raw);
  if (ref) {
    if (depth > 8) return null; // a cycle must not hang the build
    const target = theme[ref[1]];
    if (target !== undefined) return colorOf(target, theme, backdrop, depth + 1);
    if (ref[2]) return colorOf(ref[2], theme, backdrop, depth + 1);
    return null;
  }
  const translucent = toAlpha(raw);
  if (translucent) return over(translucent.rgb, translucent.alpha, backdrop);
  return toRgb(raw);
}

/** Relative luminance, WCAG 2.x. */
function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** An alpha colour composited over the surface it actually sits on. */
function over(fg, alpha, bg) {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
}

const THEMES = [
  { name: "clay dark", selector: ":root" },
  { name: "paper light", selector: "html.light" },
  { name: "vivid", selector: "html.vivid" },
];

/**
 * Text pairs. Every one of these is copy a person has to read, so AA (4.5:1) is the
 * floor with no exceptions — including `--faint`, which is a caption, not decoration.
 * [label, foreground token, background token, minimum ratio]
 */
const PAIRS = [
  ["body text", "--foreground", "--background", 4.5],
  ["body text on surface", "--foreground", "--surface", 4.5],
  ["body text on card", "--foreground", "--card", 4.5],
  ["secondary label", "--muted-foreground", "--background", 4.5],
  ["secondary label on card", "--muted-foreground", "--card", 4.5],
  ["quiet caption", "--faint", "--background", 4.5],
  ["quiet caption on card", "--faint", "--card", 4.5],
  ["signal as text", "--signal-text", "--background", 4.5],
  ["signal as text on card", "--signal-text", "--card", 4.5],
  ["ink on signal fill", "--signal-foreground", "--signal", 4.5],
  ["primary button ink", "--primary-foreground", "--primary", 4.5],
  ["destructive text", "--destructive", "--background", 4.5],
  ["success text", "--success", "--background", 4.5],
  ["warning text", "--warning", "--background", 4.5],
];

/**
 * Non-text pairs, WCAG 1.4.11 (3:1).
 *
 * The focus indicator is gated for real: it is the only thing telling a keyboard user
 * where they are, so "subtle" is not an available option. It is drawn as solid
 * `--ring` at 2px with a 2px offset — the 55% tint this used to be measured 2.06–2.55:1
 * and failed in all three palettes.
 *
 * Hairline borders are *reported, not gated*. They are decorative in this design: a
 * card is told apart from the page by its fill and elevation, and a text field by its
 * `--input` fill, so no border is the sole affordance for anything. They still get a
 * floor of 1.2, because a hairline that drops to nothing is a bug even if it is not a
 * WCAG one.
 */
const NON_TEXT = [
  ["focus ring on background", "--ring", "--background", 3.0],
  ["focus ring on card", "--ring", "--card", 3.0],
  ["hairline border (reported)", "--border-strong", "--background", 1.2],
];

let failed = 0;
const report = [];

// `:root` is the base every theme inherits from, so a theme block only has to declare
// what it changes. Reading a block in isolation would report `--ring` as missing in the
// two themes that do not redefine it — which is exactly the pair that matters most.
const base = tokens(":root");

for (const theme of THEMES) {
  const t = theme.selector === ":root" ? base : { ...base, ...tokens(theme.selector) };
  const bg = colorOf(t["--background"], t, [255, 255, 255]);
  if (!bg) throw new Error(`${theme.name}: --background is not a plain colour`);

  const rows = [];
  const check = ([label, fgToken, bgToken, min]) => {
    const rawFg = t[fgToken];
    const rawBg = t[bgToken];
    if (!rawFg || !rawBg) {
      rows.push([label, "—", `missing ${!rawFg ? fgToken : bgToken}`]);
      failed++;
      return;
    }
    const page = bg ?? [255, 255, 255];
    // A token may be translucent: what matters is what the eye sees, so composite it
    // over the surface it is actually drawn on.
    const bgRgb = colorOf(rawBg, t, page);
    const fgRgb = colorOf(rawFg, t, bgRgb ?? page);
    if (!fgRgb || !bgRgb) {
      rows.push([label, "—", `unparsable (${rawFg} / ${rawBg})`]);
      failed++;
      return;
    }
    const r = ratio(fgRgb, bgRgb);
    const ok = r >= min;
    if (!ok) failed++;
    rows.push([label, r.toFixed(2), ok ? `ok (≥${min})` : `FAIL (needs ${min})`]);
  };
  PAIRS.forEach(check);
  NON_TEXT.forEach(check);
  report.push([theme.name, rows]);
}

const w = Math.max(...report.flatMap(([, rows]) => rows.map(([l]) => l.length)), 26);
for (const [name, rows] of report) {
  console.log(`\n${name}`);
  for (const [label, value, verdict] of rows) {
    console.log(`  ${label.padEnd(w)}  ${String(value).padStart(6)}  ${verdict}`);
  }
}

if (failed) {
  console.error(`\n✗ ${failed} contrast pair(s) below their required ratio.`);
  process.exit(1);
}
console.log(
  `\n✓ all ${report.length * (PAIRS.length + NON_TEXT.length)} pairs clear their required ratio.`,
);

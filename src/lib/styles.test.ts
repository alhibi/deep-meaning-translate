import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest's import.meta.url is not a file URL under the jsdom transform; the suite runs
// from the project root, so resolve the real stylesheet from there.
const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/** Every @keyframes block, with its body, using brace matching (nested blocks are rare but legal). */
function keyframesBlocks(source: string): { name: string; body: string }[] {
  const blocks: { name: string; body: string }[] = [];
  for (const match of source.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    const open = source.indexOf("{", match.index);
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      else if (source[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push({ name: match[1]!, body: source.slice(open + 1, end) });
  }
  return blocks;
}

const LOGICAL = /(?:^|[;{\s])(?:inset|margin|padding|border)-(?:inline|block)(?:-[a-z]+)?\s*:/;

describe("stylesheet build safety", () => {
  it("keeps logical properties out of @keyframes", () => {
    // The Android bundle lowers CSS for a Chrome 80 WebView. Lightning CSS cannot
    // represent a direction-relative property inside a keyframe, so it hoists the
    // physical declaration out and scopes it to the NEXT rule in the sheet. A dead
    // `bead` keyframe once did that to `.composer-editor`, which pushed the whole
    // editing box — and the native caret — hundreds of pixels off the field in the
    // installed app only. Animated direction must be expressed with physical properties
    // (or a direction-specific keyframe), never with a logical one.
    const offenders = keyframesBlocks(css).filter((block) => LOGICAL.test(block.body));
    expect(offenders.map((block) => block.name)).toEqual([]);
  });

  it("finds the keyframes it is supposed to inspect", () => {
    // A parser bug must not make the guard vacuously green.
    const names = keyframesBlocks(css).map((block) => block.name);
    expect(names).toContain("shimmer");
    expect(names.length).toBeGreaterThan(5);
  });
});

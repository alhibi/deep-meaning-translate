/**
 * Remove macOS cloud-sync duplicates such as `values 2.xml` / `merger 3.xml`.
 * A desktop sync service keeps recreating those next to real files; the Android resource
 * merger rejects any file-based resource name with a space, so a build dies on a file the
 * project never wrote. Runs before the native build and is safe to run repeatedly.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const roots = ["android", "node_modules/@capacitor"];
const pattern = / [0-9]+(?:\.[A-Za-z0-9]+)?$/;
let removed = 0;

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (pattern.test(entry.name)) {
      await rm(full, { recursive: true, force: true });
      removed += 1;
      continue;
    }
    if (entry.isDirectory()) await walk(full);
  }
}

for (const root of roots) await walk(path.resolve(root));
console.log(`clean-sync-duplicates: removed ${removed} duplicate file(s)`);

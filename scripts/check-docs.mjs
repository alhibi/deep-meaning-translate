/**
 * Documentation gate.
 *
 * Verifies that the knowledge base is complete and navigable:
 *   - every authoritative document exists;
 *   - every relative link in the root docs and docs/ resolves to a real file;
 *   - every file under docs/ is listed in DOCUMENTATION_INDEX.md.
 *
 * It deliberately does not render Markdown or validate anchors: a link to a missing
 * file is the failure that silently rots, and that is what this gate catches.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");

const REQUIRED = [
  "AGENTS.md",
  "README.md",
  "PROJECT_CONSTITUTION.md",
  "PROJECT_MAP.md",
  "DOCUMENTATION_INDEX.md",
  "DEFINITION_OF_DONE.md",
  "docs/product/vision-and-scope.md",
  "docs/product/capabilities-and-journeys.md",
  "docs/architecture/overview.md",
  "docs/architecture/navigation-and-lifecycle.md",
  "docs/architecture/state-and-persistence.md",
  "docs/architecture/api-and-providers.md",
  "docs/architecture/decisions/0001-single-document-shell.md",
  "docs/architecture/decisions/0002-session-owns-restore-pair.md",
  "docs/architecture/decisions/0003-palette-before-paint.md",
  "docs/architecture/decisions/0004-service-worker-and-offline-shell.md",
  "docs/translation/pipeline.md",
  "docs/translation/registers-and-languages.md",
  "docs/translation/evaluation.md",
  "docs/design/system.md",
  "docs/design/motion-and-accessibility.md",
  "docs/quality/testing.md",
  "docs/quality/navigation-regression.md",
  "docs/security/privacy-and-threat-model.md",
  "docs/operations/development-and-release.md",
  "docs/audits/2026-11-07-baseline-and-repairs.md",
  "docs/audits/technical-debt.md",
  "docs/audits/final-report-ar.md",
];

const ROOT_DOCS = [
  "AGENTS.md",
  "README.md",
  "PROJECT_CONSTITUTION.md",
  "PROJECT_MAP.md",
  "DOCUMENTATION_INDEX.md",
  "DEFINITION_OF_DONE.md",
];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}

const exists = async (path) => {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
};

const problems = [];

for (const file of REQUIRED) {
  if (!(await exists(join(ROOT, file)))) problems.push(`missing required document: ${file}`);
}

const docsFiles = (await walk(DOCS)).map((path) => relative(ROOT, path).split("\\").join("/"));
const index = await readFile(join(ROOT, "DOCUMENTATION_INDEX.md"), "utf8");
for (const file of docsFiles) {
  if (!index.includes(file)) problems.push(`not listed in DOCUMENTATION_INDEX.md: ${file}`);
}

const linkable = [...ROOT_DOCS.map((file) => join(ROOT, file)), ...(await walk(DOCS))];
let links = 0;

for (const file of linkable) {
  const text = await readFile(file, "utf8");
  const dir = dirname(file);
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const raw = match[1];
    if (/^(https?:|mailto:|tel:|#)/.test(raw)) continue;
    const target = decodeURIComponent(raw.split("#")[0]);
    if (!target || target.startsWith("/")) continue; // root-absolute URLs are not file links
    links += 1;
    const path = resolve(dir, target);
    if (!(await exists(path))) {
      problems.push(`broken link in ${relative(ROOT, file)}: ${raw} -> ${relative(ROOT, path)}`);
    }
  }
}

if (problems.length) {
  console.error("docs check failed:\n" + problems.map((p) => "  - " + p).join("\n"));
  process.exit(1);
}

console.log(
  `docs ok — ${docsFiles.length + ROOT_DOCS.length} documents, ${links} relative links, all indexed`,
);

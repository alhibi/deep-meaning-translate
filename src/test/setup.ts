import "@testing-library/jest-dom/vitest";
import {
  ReadableStream as NodeReadableStream,
  TransformStream as NodeTransformStream,
  WritableStream as NodeWritableStream,
} from "node:stream/web";

/**
 * The suite runs in a shared jsdom context (`pool: vmThreads`), which is ~5× faster
 * than a fresh environment per file. A vm context does not inherit Node's web
 * platform globals, and the app's streaming code needs the real ones — not stubs.
 * Only what is missing is filled in, so a future environment that provides them wins.
 */
const webGlobals = {
  ReadableStream: NodeReadableStream,
  WritableStream: NodeWritableStream,
  TransformStream: NodeTransformStream,
} as const;

for (const [name, value] of Object.entries(webGlobals)) {
  if (!(name in globalThis)) {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
}

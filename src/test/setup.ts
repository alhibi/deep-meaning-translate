import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
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

/**
 * Testing Library unmounts what it rendered between tests — but only when a global
 * `afterEach` exists, which it does not here (`globals: false`). Registering it
 * explicitly keeps a shared jsdom from leaking one test's DOM into the next.
 */
afterEach(() => cleanup());

/** jsdom has no layout, so it prints a warning for every scroll the router restores. */
if (typeof window !== "undefined" && !("__scrollStubbed" in window)) {
  Object.defineProperty(window, "__scrollStubbed", { value: true });
  window.scrollTo = () => {};
}

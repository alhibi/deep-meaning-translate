import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The service worker is the difference between an app and a website, and also the way
 * a bad build gets stuck on someone's phone. These tests pin the rules: register only
 * in production, never in an iframe or a preview host, and unregister our own worker
 * everywhere else so a stale cache can never shadow the live app.
 */
const register = vi.fn(async () => undefined);
const getRegistrations = vi.fn(async () => [
  { active: { scriptURL: "https://fluently.today/sw.js" }, unregister: vi.fn(async () => true) },
  {
    active: { scriptURL: "https://fluently.today/other-sw.js" },
    unregister: vi.fn(async () => true),
  },
]);

async function loadModule() {
  vi.resetModules();
  return import("./pwa");
}

describe("service worker registrar", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { serviceWorker: { register, getRegistrations } });
    register.mockClear();
    getRegistrations.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing when the browser has no service worker support", async () => {
    vi.stubGlobal("navigator", {});
    const { initServiceWorker } = await loadModule();
    expect(() => initServiceWorker()).not.toThrow();
    expect(register).not.toHaveBeenCalled();
  });

  it("never registers in a development build", async () => {
    const { initServiceWorker } = await loadModule();
    initServiceWorker();
    expect(register).not.toHaveBeenCalled();
    expect(getRegistrations).toHaveBeenCalled();
  });
});

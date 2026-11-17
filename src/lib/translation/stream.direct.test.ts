// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The personal-key path speaks DeepSeek from the device. Luna is a server-side brain, so a
 * Luna request must stay on the service: a device key must never silently override the
 * model the person chose.
 */
const direct = vi.hoisted(() => vi.fn());
const diagnostics = vi.hoisted(() => ({
  beginTransport: vi.fn(() => ({ finish: vi.fn() })),
  classifyFetchError: vi.fn(() => "network" as const),
  classifyStatus: vi.fn(() => "network" as const),
  safeDiagnosticMessage: vi.fn(() => undefined),
}));

vi.mock("../native/config", () => ({
  isNativeApp: () => true,
  nativeApiUrl: (path: string) => `https://today.test${path}`,
}));
vi.mock("./providerKey", () => ({ hasProviderKey: () => true }));
vi.mock("./direct", () => ({ streamDirect: direct }));
vi.mock("../native/diagnostics", () => diagnostics);

const { streamTranslate } = await import("./stream");

const streamed = (text: string) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
  );

beforeEach(() => {
  direct.mockReset();
  direct.mockResolvedValue({ ok: true, text: "مباشر من الجهاز" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => streamed("من الخدمة")),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("personal-key routing", () => {
  it("keeps a Luna request on the service instead of the device DeepSeek key", async () => {
    const res = await streamTranslate(
      { text: "Hallo", brain: "luna" },
      new AbortController().signal,
      () => {},
      "live",
    );
    expect(direct).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, text: "من الخدمة" });
  });

  it("still uses the device key for a DeepSeek request", async () => {
    const res = await streamTranslate(
      { text: "Hallo", brain: "deepseek" },
      new AbortController().signal,
      () => {},
      "live",
    );
    expect(direct).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true, text: "مباشر من الجهاز", writer: "deepseek" });
  });
});

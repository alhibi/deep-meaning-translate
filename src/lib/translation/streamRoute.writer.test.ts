// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationError } from "./types";
import { providerHealth, resetProviderHealthForTests } from "./providers/health.server";

/**
 * The response must name the brain that actually wrote the answer, not the one the person
 * asked for. The client sends that name back with the quiet review so DeepSeek never
 * reviews its own fallback output.
 */
const opencode = vi.hoisted(() => ({ live: vi.fn(), full: vi.fn() }));
const deepseek = vi.hoisted(() => ({ live: vi.fn(), full: vi.fn() }));
/** The DeepSeek key the mocked module reports; tests flip it to simulate one-writer mode. */
const keyState = vi.hoisted(() => ({ deepseek: "deepseek-key" as string | null }));

vi.mock("./providers/opencode.server", () => ({
  createOpenCodeLunaProvider: vi.fn(),
  streamLiveTranslation: (...args: unknown[]) => opencode.live(...args),
  streamFullTranslation: (...args: unknown[]) => opencode.full(...args),
}));
vi.mock("./providers/deepseek.server", () => ({
  deepseekKey: () => keyState.deepseek,
  streamDeepSeekLive: (...args: unknown[]) => deepseek.live(...args),
  streamDeepSeekFull: (...args: unknown[]) => deepseek.full(...args),
}));

const { handleTranslateStream } = await import("./streamRoute.server");

const textStream = (text: string) =>
  (async function* () {
    yield text;
  })();

const request = (brain: "deepseek" | "luna") =>
  new Request("http://localhost:8080/api/translate-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Hallo", source: "de", target: "ar", style: "natural", brain }),
  });

beforeEach(() => {
  vi.stubEnv("OPENCODE_API_KEY", "opencode-key");
  vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-key");
  keyState.deepseek = "deepseek-key";
  resetProviderHealthForTests();
  opencode.live.mockReset();
  opencode.full.mockReset();
  deepseek.live.mockReset();
  deepseek.full.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("writer attribution on the stream response", () => {
  it("names the fallback writer when Luna fails and DeepSeek takes over", async () => {
    opencode.live.mockRejectedValue(new TranslationError("quota", "empty"));
    deepseek.live.mockImplementation(() => textStream("من الخادم"));
    const response = await handleTranslateStream(request("luna"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-translation-writer")).toBe("deepseek");
    expect(await response.text()).toBe("من الخادم");
  });

  it("names Luna when Luna wrote the answer", async () => {
    opencode.live.mockImplementation(() => textStream("من لونا"));
    const response = await handleTranslateStream(request("luna"));
    expect(response.headers.get("x-translation-writer")).toBe("luna");
    expect(deepseek.live).not.toHaveBeenCalled();
    expect(await response.text()).toBe("من لونا");
  });

  it("does not wait out a provider retry when the other writer can answer now", async () => {
    opencode.live.mockRejectedValue(new TranslationError("rate", "busy"));
    deepseek.live.mockImplementation(() => textStream("من الخادم"));
    const response = await handleTranslateStream(request("luna"));

    // The requested writer makes one attempt so the fallback starts immediately instead
    // of sleeping through Retry-After (the deployed Sona path spent 2.5 s there). The
    // fallback keeps the bounded retry: it is the last usable writer and a transient
    // failure there must still heal.
    expect((opencode.live.mock.calls[0] as unknown[])[3]).toEqual({ maxAttempts: 1 });
    expect((deepseek.live.mock.calls[0] as unknown[])[3]).toBeUndefined();
    expect(response.headers.get("x-translation-fallback")).toBe("rate");
    expect(await response.text()).toBe("من الخادم");
  });

  it("keeps the provider retry when only one writer is configured", async () => {
    keyState.deepseek = null;
    opencode.live.mockImplementation(() => textStream("من لونا"));
    const response = await handleTranslateStream(request("luna"));

    expect(response.headers.get("x-translation-writer")).toBe("luna");
    expect((opencode.live.mock.calls[0] as unknown[])[3]).toBeUndefined();
    expect(await response.text()).toBe("من لونا");
  });

  it("keeps the retry for the requested writer when the alternative is cooling", async () => {
    // First sentence: Luna fails, so it is in a cooldown.
    opencode.live.mockRejectedValue(new TranslationError("rate", "busy"));
    deepseek.live.mockImplementation(() => textStream("من الخادم"));
    await (await handleTranslateStream(request("luna"))).text();

    // A Velo sentence now has no usable alternative: DeepSeek must keep its own retry.
    deepseek.live.mockImplementation(() => textStream("من الخادم"));
    const response = await handleTranslateStream(request("deepseek"));
    expect(response.headers.get("x-translation-writer")).toBe("deepseek");
    expect((deepseek.live.mock.calls.at(-1) as unknown[])[3]).toBeUndefined();
    expect(await response.text()).toBe("من الخادم");
  });

  it("records a failed fallback too, so the next request does not route into it blindly", async () => {
    opencode.live.mockRejectedValue(new TranslationError("rate", "busy"));
    deepseek.live.mockRejectedValue(new TranslationError("network", "down"));
    const response = await handleTranslateStream(request("luna"));
    expect(response.status).toBe(502);
    const health = providerHealth();
    expect(health.map((entry) => entry.brain).sort()).toEqual(["deepseek", "luna"]);
  });

  it("skips a writer that just failed instead of paying its failure again", async () => {
    opencode.live.mockRejectedValue(new TranslationError("rate", "busy"));
    deepseek.live.mockImplementation(() => textStream("من الخادم"));

    const first = await handleTranslateStream(request("luna"));
    expect(await first.text()).toBe("من الخادم");
    expect(opencode.live).toHaveBeenCalledTimes(1);

    // The cooldown means the next Sona sentence goes straight to the healthy writer.
    const second = await handleTranslateStream(request("luna"));
    expect(opencode.live).toHaveBeenCalledTimes(1);
    expect(writerOf(second)).toBe("deepseek");
    expect(second.headers.get("x-translation-fallback")).toBe("cooldown");
    expect(await second.text()).toBe("من الخادم");
  });

  it("uses the requested writer again once the cooldown expires", async () => {
    opencode.live.mockRejectedValue(new TranslationError("provider", "bad moment"));
    deepseek.live.mockImplementation(() => textStream("من الخادم"));
    await (await handleTranslateStream(request("luna"))).text();

    opencode.live.mockReset();
    opencode.live.mockImplementation(() => textStream("من لونا"));
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    const response = await handleTranslateStream(request("luna"));
    expect(response.headers.get("x-translation-writer")).toBe("luna");
    expect(await response.text()).toBe("من لونا");
    vi.restoreAllMocks();
  });
});

function writerOf(response: Response): string | null {
  return response.headers.get("x-translation-writer");
}

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationError } from "./types";

/**
 * The response must name the brain that actually wrote the answer, not the one the person
 * asked for. The client sends that name back with the quiet review so DeepSeek never
 * reviews its own fallback output.
 */
const opencode = vi.hoisted(() => ({ live: vi.fn(), full: vi.fn() }));
const deepseek = vi.hoisted(() => ({ live: vi.fn(), full: vi.fn() }));

vi.mock("./providers/opencode.server", () => ({
  createOpenCodeLunaProvider: vi.fn(),
  streamLiveTranslation: (...args: unknown[]) => opencode.live(...args),
  streamFullTranslation: (...args: unknown[]) => opencode.full(...args),
}));
vi.mock("./providers/deepseek.server", () => ({
  deepseekKey: () => "deepseek-key",
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
  opencode.live.mockReset();
  opencode.full.mockReset();
  deepseek.live.mockReset();
  deepseek.full.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("writer attribution on the stream response", () => {
  it("names the fallback writer when Luna fails and DeepSeek takes over", async () => {
    opencode.live.mockRejectedValue(new TranslationError("quota", "empty"));
    deepseek.live.mockReturnValue(textStream("من الخادم"));
    const response = await handleTranslateStream(request("luna"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-translation-writer")).toBe("deepseek");
    expect(await response.text()).toBe("من الخادم");
  });

  it("names Luna when Luna wrote the answer", async () => {
    opencode.live.mockReturnValue(textStream("من لونا"));
    const response = await handleTranslateStream(request("luna"));
    expect(response.headers.get("x-translation-writer")).toBe("luna");
    expect(deepseek.live).not.toHaveBeenCalled();
    expect(await response.text()).toBe("من لونا");
  });
});

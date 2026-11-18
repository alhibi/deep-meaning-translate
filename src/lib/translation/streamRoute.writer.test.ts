// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationError } from "./types";

/**
 * Strict model selection at the stream boundary.
 *
 * The response must name and use the requested writer only: no automatic second-model
 * fallback, no cooldown rerouting, no Retry-After wait. A rejecting model fails the
 * request visibly instead of letting the other model answer under its name.
 */
const opencode = vi.hoisted(() => ({ live: vi.fn(), full: vi.fn() }));
const deepseek = vi.hoisted(() => ({ live: vi.fn(), full: vi.fn() }));
/** The DeepSeek key the mocked module reports; tests flip it to simulate a missing key. */
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

const request = (brain: "deepseek" | "luna", mode: "live" | "full" = "live") =>
  new Request("http://localhost:8080/api/translate-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "Hallo",
      source: "de",
      target: "ar",
      style: "natural",
      brain,
      mode,
      partial: mode !== "full",
    }),
  });

beforeEach(() => {
  vi.stubEnv("OPENCODE_API_KEY", "opencode-key");
  vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-key");
  keyState.deepseek = "deepseek-key";
  opencode.live.mockReset();
  opencode.full.mockReset();
  deepseek.live.mockReset();
  deepseek.full.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const bodyKind = async (response: Response) => ((await response.json()) as { kind?: string }).kind;

describe("strict writer selection", () => {
  it("writes Velo through DeepSeek and never calls Sona", async () => {
    deepseek.full.mockImplementation(() => textStream("من فيلو"));
    const response = await handleTranslateStream(request("deepseek", "full"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-translation-writer")).toBe("deepseek");
    expect(await response.text()).toBe("من فيلو");
    expect(opencode.full).not.toHaveBeenCalled();
    expect(opencode.live).not.toHaveBeenCalled();
  });

  it("writes Sona through Luna and never calls Velo", async () => {
    opencode.full.mockImplementation(() => textStream("من سونا"));
    const response = await handleTranslateStream(request("luna", "full"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-translation-writer")).toBe("luna");
    expect(await response.text()).toBe("من سونا");
    expect(deepseek.full).not.toHaveBeenCalled();
  });

  it("never falls back to Velo when Sona rejects the request", async () => {
    opencode.full.mockRejectedValue(new TranslationError("rate", "busy"));
    const response = await handleTranslateStream(request("luna", "full"));
    expect(response.status).toBe(429);
    expect(await bodyKind(response)).toBe("rate");
    expect(deepseek.full).not.toHaveBeenCalled();
    expect(deepseek.live).not.toHaveBeenCalled();
  });

  it("never falls back to Sona when Velo rejects the request", async () => {
    deepseek.full.mockRejectedValue(new TranslationError("quota", "empty"));
    const response = await handleTranslateStream(request("deepseek", "full"));
    expect(response.status).toBe(502);
    expect(await bodyKind(response)).toBe("quota");
    expect(opencode.full).not.toHaveBeenCalled();
  });

  it("makes exactly one attempt on the selected provider (no Retry-After wait)", async () => {
    opencode.full.mockImplementation(() => textStream("من سونا"));
    await (await handleTranslateStream(request("luna", "full"))).text();
    expect((opencode.full.mock.calls[0] as unknown[])[3]).toEqual({ maxAttempts: 1 });
  });

  it("reports a clear auth failure for a missing selected key, without the other model", async () => {
    keyState.deepseek = null;
    const response = await handleTranslateStream(request("deepseek", "full"));
    expect(response.status).toBe(502);
    expect(await bodyKind(response)).toBe("auth");
    expect(opencode.full).not.toHaveBeenCalled();
  });

  it("does not advertise a fallback header", async () => {
    opencode.full.mockImplementation(() => textStream("من سونا"));
    const response = await handleTranslateStream(request("luna", "full"));
    expect(response.headers.get("x-translation-fallback")).toBeNull();
    void (await response.text());
  });
});

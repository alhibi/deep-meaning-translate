import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Brain, TranslationRequest, TranslationResult } from "./types";

/**
 * Cancellation contract for the quiet second pass.
 *
 * A caller-owned AbortSignal must reach the provider request, so a disconnected client
 * (or a superseded sentence) stops the repair/review call instead of paying for it to
 * completion. The Luna-enabled path is faked here because production currently runs
 * DeepSeek-only; the routing under test is the same engine code either way.
 */
const mocks = vi.hoisted(() => ({
  lunaRepair: vi.fn(),
  review: vi.fn(),
}));

vi.mock("./types", async (orig) => {
  const actual = await orig<typeof import("./types")>();
  return {
    ...actual,
    LUNA_ENABLED: true,
    effectiveBrain: (brain?: Brain) => brain ?? "luna",
  };
});

vi.mock("./providers/opencode.server", () => ({
  createOpenCodeLunaProvider: () => ({
    id: "opencode",
    translate: vi.fn(),
    repair: mocks.lunaRepair,
  }),
}));

vi.mock("./providers/deepseek.server", async (orig) => ({
  ...(await orig<typeof import("./providers/deepseek.server")>()),
  reviewTranslation: mocks.review,
}));

const req: TranslationRequest = {
  text: "Ich habe 3 Katzen.",
  source: "de",
  target: "ar",
  style: "natural",
  brain: "luna",
};
const res = (translation: string): TranslationResult => ({
  sourceLanguage: "de",
  targetLanguage: "ar",
  translation,
  tone: "",
  formality: "neutral",
  confidence: 0.9,
  isAmbiguous: false,
  alternativeTranslations: [],
  notes: "",
});

beforeEach(() => {
  vi.stubEnv("OPENCODE_API_KEY", "luna");
  vi.stubEnv("DEEPSEEK_API_KEY", "ds");
  mocks.lunaRepair.mockReset();
  mocks.review.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const engine = () => import("./engine.server");

describe("quiet second pass cancellation", () => {
  it("passes an aborted signal into the repair provider call", async () => {
    // A lost number is exactly the deterministic issue that triggers a repair.
    const previous = res("لدي قطط.");
    mocks.lunaRepair.mockResolvedValue(res("لدي 3 قطط."));
    const controller = new AbortController();
    controller.abort();
    const repaired = await (
      await engine()
    ).runRepair(req, previous, {
      signal: controller.signal,
    });
    expect(repaired?.translation).toBe("لدي 3 قطط.");
    expect(mocks.lunaRepair).toHaveBeenCalledTimes(1);
    const signal = mocks.lunaRepair.mock.calls[0]?.[3] as AbortSignal | undefined;
    expect(signal).toBe(controller.signal);
    expect(signal?.aborted).toBe(true);
  });

  it("passes an aborted signal into the independent review call", async () => {
    mocks.review.mockResolvedValue(null);
    const controller = new AbortController();
    controller.abort();
    const reviewed = await (
      await engine()
    ).runRepair(req, res("لدي 3 قطط."), {
      signal: controller.signal,
    });
    expect(reviewed).toBeNull();
    expect(mocks.review).toHaveBeenCalledTimes(1);
    const signal = mocks.review.mock.calls[0]?.[3] as AbortSignal | undefined;
    expect(signal).toBe(controller.signal);
    expect(signal?.aborted).toBe(true);
  });

  it("keeps the old call shape when no signal is supplied", async () => {
    mocks.lunaRepair.mockResolvedValue(res("لدي 3 قطط."));
    await (await engine()).runRepair(req, res("لدي قطط."));
    expect(mocks.lunaRepair.mock.calls[0]?.[3]).toBeUndefined();
  });
});

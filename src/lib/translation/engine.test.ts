import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationRequest, TranslationResult } from "./types";
import { LUNA_ENABLED, TranslationError } from "./types";

/** Luna-only behaviour; skipped while Luna is paused ("soon"). */
const lunaIt = it.skipIf(!LUNA_ENABLED);

const lunaTranslate = vi.fn();
const dsTranslate = vi.fn();
const review = vi.fn();

vi.mock("./providers/opencode.server", () => ({
  createOpenCodeLunaProvider: () => ({ id: "opencode", translate: lunaTranslate, repair: vi.fn() }),
}));
vi.mock("./providers/deepseek.server", async (orig) => ({
  ...(await orig<typeof import("./providers/deepseek.server")>()),
  createDeepSeekProvider: () => ({ id: "deepseek", translate: dsTranslate, repair: vi.fn() }),
  reviewTranslation: review,
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
  lunaTranslate.mockReset();
  dsTranslate.mockReset();
  review.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const engine = () => import("./engine.server");

describe("two brains", () => {
  lunaIt("Luna translates; DeepSeek is not called when Luna succeeds", async () => {
    lunaTranslate.mockResolvedValue(res("عندي 3 قطط."));
    const { result } = await (await engine()).runTranslation(req);
    expect(result.translation).toBe("عندي 3 قطط.");
    expect(dsTranslate).not.toHaveBeenCalled();
  });

  it("DeepSeek takes over when Luna is out of credit", async () => {
    lunaTranslate.mockRejectedValue(new TranslationError("quota", "empty"));
    dsTranslate.mockResolvedValue(res("لدي 3 قطط."));
    const { result } = await (await engine()).runTranslation(req);
    expect(result.translation).toBe("لدي 3 قطط.");
  });

  lunaIt("without a DeepSeek key, Luna's error is reported as before", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    lunaTranslate.mockRejectedValue(new TranslationError("quota", "empty"));
    await expect((await engine()).runTranslation(req)).rejects.toMatchObject({ kind: "quota" });
  });

  it("review keeps a correct translation (no flicker)", async () => {
    review.mockResolvedValue(null);
    expect(await (await engine()).runRepair(req, res("عندي 3 قطط."))).toBeNull();
  });

  lunaIt("review swaps in a real correction", async () => {
    review.mockResolvedValue(res("عندي ثلاث 3 قطط."));
    const out = await (await engine()).runRepair(req, res("عندي 3 قط."));
    expect(out?.translation).toBe("عندي ثلاث 3 قطط.");
  });

  it("review is refused when it drops a number the original kept", async () => {
    review.mockResolvedValue(res("عندي قطط."));
    expect(await (await engine()).runRepair(req, res("عندي 3 قط."))).toBeNull();
  });

  it("review is skipped entirely without a DeepSeek key", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(await (await engine()).runRepair(req, res("عندي 3 قط."))).toBeNull();
    expect(review).not.toHaveBeenCalled();
  });
});

describe("model choice", () => {
  const { brain: _b, ...dsReq } = req;
  it("DeepSeek is the default writer; Luna is not called when it succeeds", async () => {
    dsTranslate.mockResolvedValue(res("لدي 3 قطط."));
    const { result } = await (await engine()).runTranslation(dsReq);
    expect(result.translation).toBe("لدي 3 قطط.");
    expect(lunaTranslate).not.toHaveBeenCalled();
  });
  lunaIt("Luna takes over when DeepSeek fails", async () => {
    dsTranslate.mockRejectedValue(new TranslationError("rate", "busy"));
    lunaTranslate.mockResolvedValue(res("عندي 3 قطط."));
    const { result } = await (await engine()).runTranslation(dsReq);
    expect(result.translation).toBe("عندي 3 قطط.");
  });
  it("DeepSeek never reviews its own translation", async () => {
    expect(await (await engine()).runRepair(dsReq, res("عندي 3 قط."))).toBeNull();
    expect(review).not.toHaveBeenCalled();
  });
});

describe("parseReview", () => {
  it("reads keep, corrections and garbage safely", async () => {
    const { parseReview } = await import("./providers/deepseek.server");
    expect(parseReview('{"verdict":"keep"}', req)).toBeNull();
    expect(parseReview('{"translation":"عندي 3 قطط."}', req)?.translation).toBe("عندي 3 قطط.");
    expect(parseReview("not json", req)).toBeNull();
    expect(parseReview('{"translation":""}', req)).toBeNull();
  });
});

describe("Luna paused", () => {
  it.runIf(!LUNA_ENABLED)(
    "an old Luna choice is written by DeepSeek; Luna is never called",
    async () => {
      dsTranslate.mockResolvedValue(res("لدي 3 قطط."));
      const { result } = await (await engine()).runTranslation(req);
      expect(result.translation).toBe("لدي 3 قطط.");
      expect(lunaTranslate).not.toHaveBeenCalled();
    },
  );
  it.runIf(!LUNA_ENABLED)("a DeepSeek failure is reported, never handed to Luna", async () => {
    dsTranslate.mockRejectedValue(new TranslationError("rate", "busy"));
    await expect((await engine()).runTranslation(req)).rejects.toMatchObject({ kind: "rate" });
    expect(lunaTranslate).not.toHaveBeenCalled();
  });
});

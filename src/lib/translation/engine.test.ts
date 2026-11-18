import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationRequest, TranslationResult } from "./types";
import { TranslationError } from "./types";

const lunaTranslate = vi.fn();
const dsTranslate = vi.fn();
const lunaRepair = vi.fn();
const dsRepair = vi.fn();

vi.mock("./providers/opencode.server", () => ({
  createOpenCodeLunaProvider: () => ({
    id: "opencode",
    translate: lunaTranslate,
    repair: lunaRepair,
  }),
}));
vi.mock("./providers/deepseek.server", async (orig) => ({
  ...(await orig<typeof import("./providers/deepseek.server")>()),
  createDeepSeekProvider: () => ({ id: "deepseek", translate: dsTranslate, repair: dsRepair }),
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
  lunaRepair.mockReset();
  dsRepair.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const engine = () => import("./engine.server");

describe("strict model choice", () => {
  it("Luna writes the answer and DeepSeek is never called", async () => {
    lunaTranslate.mockResolvedValue(res("عندي 3 قطط."));
    const { result } = await (await engine()).runTranslation(req);
    expect(result.translation).toBe("عندي 3 قطط.");
    expect(dsTranslate).not.toHaveBeenCalled();
  });

  it("a Luna failure is reported instead of being handed to DeepSeek", async () => {
    lunaTranslate.mockRejectedValue(new TranslationError("quota", "empty"));
    await expect((await engine()).runTranslation(req)).rejects.toMatchObject({ kind: "quota" });
    expect(dsTranslate).not.toHaveBeenCalled();
  });

  it("DeepSeek is the default writer and Luna is never called", async () => {
    dsTranslate.mockResolvedValue(res("لدي 3 قطط."));
    const { brain: _b, ...dsReq } = req;
    const { result } = await (await engine()).runTranslation(dsReq);
    expect(result.translation).toBe("لدي 3 قطط.");
    expect(lunaTranslate).not.toHaveBeenCalled();
  });

  it("a DeepSeek failure is not rescued by Luna", async () => {
    dsTranslate.mockRejectedValue(new TranslationError("rate", "busy"));
    const { brain: _b, ...dsReq } = req;
    await expect((await engine()).runTranslation(dsReq)).rejects.toMatchObject({ kind: "rate" });
    expect(lunaTranslate).not.toHaveBeenCalled();
  });

  it("reports a clear auth error when the selected model has no key", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "");
    await expect((await engine()).runTranslation(req)).rejects.toMatchObject({ kind: "auth" });
    expect(dsTranslate).not.toHaveBeenCalled();
  });
});

describe("same-model quiet repair only", () => {
  it("does nothing when deterministic checks found no issue", async () => {
    expect(await (await engine()).runRepair(req, res("عندي 3 قطط."))).toBeNull();
    expect(lunaRepair).not.toHaveBeenCalled();
  });

  it("repairs a lost number through the selected model", async () => {
    lunaRepair.mockResolvedValue(res("عندي 3 قطط."));
    const out = await (await engine()).runRepair(req, res("عندي قطط."));
    expect(out?.translation).toBe("عندي 3 قطط.");
    expect(lunaRepair).toHaveBeenCalledTimes(1);
  });

  it("never calls the other model when the selected repair fails", async () => {
    lunaRepair.mockRejectedValue(new TranslationError("rate", "busy"));
    expect(await (await engine()).runRepair(req, res("عندي قطط."))).toBeNull();
    expect(dsRepair).not.toHaveBeenCalled();
  });

  it("never calls the other model when the selected repair makes it worse", async () => {
    lunaRepair.mockResolvedValue(res("نص مختلف تماماً"));
    expect(await (await engine()).runRepair(req, res("عندي قطط."))).toBeNull();
    expect(dsRepair).not.toHaveBeenCalled();
  });
});

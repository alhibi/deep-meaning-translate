import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeJsonMock = vi.fn();
const repairDirectMock = vi.fn();
const lookupLexicon = vi.fn();
const analyzeShadow = vi.fn();
const repairTranslation = vi.fn();
const assemblyToken = vi.fn();
let native = true;
let personalKey = false;

vi.mock("./config", () => ({ isNativeApp: () => native }));
vi.mock("./transport", () => ({ nativeJson: (...args: unknown[]) => nativeJsonMock(...args) }));
vi.mock("../translation/providerKey", () => ({ hasProviderKey: () => personalKey }));
vi.mock("../translation/directRepair", () => ({
  repairDirect: (...args: unknown[]) => repairDirectMock(...args),
}));
vi.mock("../translation/lexicon.functions", () => ({
  lookupLexicon: (...args: unknown[]) => lookupLexicon(...args),
}));
vi.mock("../translation/shadow.functions", () => ({
  analyzeShadow: (...args: unknown[]) => analyzeShadow(...args),
}));
vi.mock("../translation/translate.functions", () => ({
  repairTranslation: (...args: unknown[]) => repairTranslation(...args),
}));
vi.mock("../assembly.functions", () => ({
  assemblyToken: (...args: unknown[]) => assemblyToken(...args),
}));

const { callDictationToken, callLexicon, callRepair, callShadow } = await import("./rpc");

beforeEach(() => {
  native = true;
  personalKey = false;
  nativeJsonMock.mockReset();
  lookupLexicon.mockReset().mockResolvedValue({ ok: true, lexicon: null });
  analyzeShadow.mockReset().mockResolvedValue({ shadow: null });
  repairTranslation.mockReset().mockResolvedValue({ ok: true, result: null });
  repairDirectMock.mockReset().mockResolvedValue(null);
  assemblyToken.mockReset().mockResolvedValue({ ok: true, token: "t" });
});
afterEach(() => {
  native = true;
  personalKey = false;
});

describe("rpc forwards the caller's AbortSignal to the real transport", () => {
  it("native lexicon", async () => {
    const ctrl = new AbortController();
    nativeJsonMock.mockResolvedValue({ ok: true, lexicon: null });
    await callLexicon({
      data: { text: "bank", source: "en", target: "ar", uiLocale: "ar" },
      signal: ctrl.signal,
    });
    expect(nativeJsonMock).toHaveBeenCalledWith(
      "/api/native/v1/lexicon",
      expect.anything(),
      30_000,
      ctrl.signal,
    );
  });

  it("native shadow", async () => {
    const ctrl = new AbortController();
    nativeJsonMock.mockResolvedValue({ shadow: null });
    await callShadow({
      data: {
        text: "a",
        translation: "b",
        source: "de",
        target: "ar",
        style: "natural",
        uiLocale: "ar",
      },
      signal: ctrl.signal,
    });
    expect(nativeJsonMock).toHaveBeenCalledWith(
      "/api/native/v1/shadow",
      expect.anything(),
      30_000,
      ctrl.signal,
    );
  });

  it("native repair and dictation", async () => {
    const ctrl = new AbortController();
    nativeJsonMock.mockResolvedValue({ ok: true, result: null });
    await callRepair({ data: { request: {}, previous: {} as never }, signal: ctrl.signal });
    expect(nativeJsonMock).toHaveBeenCalledWith(
      "/api/native/v1/repair",
      expect.anything(),
      30_000,
      ctrl.signal,
    );
    nativeJsonMock.mockResolvedValue({ ok: true, token: "t" });
    await callDictationToken({ signal: ctrl.signal });
    expect(nativeJsonMock).toHaveBeenCalledWith(
      "/api/native/v1/dictation-token",
      {},
      20_000,
      ctrl.signal,
    );
  });

  it("native personal-key repair forwards the signal to the direct provider call", async () => {
    native = true;
    personalKey = true;
    const ctrl = new AbortController();
    const request = { text: "Hallo", source: "de", target: "ar", style: "natural" };
    const previous = { translation: "مرحبا" };
    await callRepair({
      data: { request, previous: previous as never },
      signal: ctrl.signal,
    });
    expect(repairDirectMock).toHaveBeenCalledWith(request, previous, ctrl.signal);
  });

  it("web server functions receive the signal as a transport option", async () => {
    native = false;
    const ctrl = new AbortController();
    const data = { text: "bank", source: "en", target: "ar", uiLocale: "ar" as const };
    await callLexicon({ data, signal: ctrl.signal });
    expect(lookupLexicon).toHaveBeenCalledWith({ data, signal: ctrl.signal });

    const shadowData = {
      text: "a",
      translation: "b",
      source: "de",
      target: "ar",
      style: "natural",
      uiLocale: "ar" as const,
    };
    await callShadow({ data: shadowData, signal: ctrl.signal });
    expect(analyzeShadow).toHaveBeenCalledWith({ data: shadowData, signal: ctrl.signal });

    const request = { text: "Hallo", source: "de", target: "ar", style: "natural" };
    await callRepair({
      data: { request, previous: {} as never },
      signal: ctrl.signal,
    });
    expect(repairTranslation).toHaveBeenCalledWith({
      data: { request, previous: {} },
      signal: ctrl.signal,
    });
  });

  it("still works when no signal is supplied", async () => {
    native = false;
    await callLexicon({ data: { text: "bank", source: "en", target: "ar", uiLocale: "ar" } });
    expect(lookupLexicon).toHaveBeenCalledWith({
      data: { text: "bank", source: "en", target: "ar", uiLocale: "ar" },
    });
  });
});

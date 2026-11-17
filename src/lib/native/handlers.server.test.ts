// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ runRepair: vi.fn() }));
const lexicon = vi.hoisted(() => ({ analyzeLexiconFor: vi.fn() }));
const shadow = vi.hoisted(() => ({ analyzeShadowFor: vi.fn() }));

vi.mock("../translation/engine.server", () => ({ runRepair: engine.runRepair }));
vi.mock("../translation/lexicon.functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../translation/lexicon.functions")>();
  return { ...actual, analyzeLexiconFor: lexicon.analyzeLexiconFor };
});
vi.mock("../translation/shadow.functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../translation/shadow.functions")>();
  return { ...actual, analyzeShadowFor: shadow.analyzeShadowFor };
});
// Admission is not the subject here: a spent token must never turn a cancellation test red.
vi.mock("../translation/throttle", () => ({
  takeRepairToken: () => true,
  takeEnrichmentToken: () => true,
  takeDictationToken: () => true,
}));

const { nativeDictation, nativeLexicon, nativeRepair, nativeShadow } =
  await import("./handlers.server");

const BASE = "https://fluently.today";
const REPAIR_URL = `${BASE}/api/native/v1/repair`;
const LEXICON_URL = `${BASE}/api/native/v1/lexicon`;
const SHADOW_URL = `${BASE}/api/native/v1/shadow`;
const DICTATION_URL = `${BASE}/api/native/v1/dictation-token`;

const headers = { Origin: "https://localhost", "Content-Type": "application/json" };

function request(url: string, body: unknown, ctrl?: AbortController): Request {
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    ...(ctrl ? { signal: ctrl.signal } : {}),
  });
}

function oversized(bodySize = 200_000): Request {
  return new Request(REPAIR_URL, { method: "POST", headers, body: "x".repeat(bodySize) });
}

const repairBody = {
  request: { text: "Hallo", source: "de", target: "ar", style: "natural" },
  previous: {
    sourceLanguage: "de",
    targetLanguage: "ar",
    translation: "مرحبا",
    tone: "",
    formality: "neutral",
    confidence: 0.9,
    isAmbiguous: false,
    alternativeTranslations: [],
    notes: "",
  },
};
const lexiconBody = { text: "bank", source: "en", target: "ar", uiLocale: "ar" };
const shadowBody = {
  text: "wie geht es dir",
  translation: "كيف حالك",
  source: "de",
  target: "ar",
  style: "natural",
  uiLocale: "ar",
};

beforeEach(() => {
  engine.runRepair.mockReset().mockResolvedValue(null);
  lexicon.analyzeLexiconFor.mockReset().mockResolvedValue(null);
  shadow.analyzeShadowFor.mockReset().mockResolvedValue(null);
  vi.stubEnv("ASSEMBLYAI_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/**
 * A5-01 regression: every native handler must bound the body before it parses or spends
 * an admission token. A huge unauthenticated body used to be buffered and JSON.parsed.
 */
describe("native handlers bound their request body", () => {
  it("refuses an oversized repair body as input without provider work", async () => {
    for (let i = 0; i < 3; i++) {
      const response = await nativeRepair(oversized());
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, kind: "input" });
    }
  });

  it("refuses oversized lexicon and shadow bodies as input", async () => {
    const lexiconResponse = await nativeLexicon(oversized());
    expect(lexiconResponse.status).toBe(400);
    expect(await lexiconResponse.json()).toEqual({ ok: false, kind: "input" });
    const shadowResponse = await nativeShadow(oversized());
    expect(shadowResponse.status).toBe(400);
    expect(await shadowResponse.json()).toEqual({ ok: false, kind: "input" });
  });

  it("still refuses a malformed small body as input", async () => {
    const response = await nativeRepair(
      new Request(REPAIR_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ request: { text: "" }, previous: null }),
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("native handler request cancellation", () => {
  it("spends nothing for a request the client already abandoned", async () => {
    for (const [handler, url, body, domain] of [
      [nativeRepair, REPAIR_URL, repairBody, engine.runRepair],
      [nativeLexicon, LEXICON_URL, lexiconBody, lexicon.analyzeLexiconFor],
      [nativeShadow, SHADOW_URL, shadowBody, shadow.analyzeShadowFor],
    ] as const) {
      const ctrl = new AbortController();
      const req = request(url, body, ctrl);
      ctrl.abort();
      const response = await handler(req);
      // The established quiet-cancellation status: nobody is left to read a result.
      expect(response.status).toBe(204);
      expect(domain).not.toHaveBeenCalled();
    }
  });

  it("drops a provider result when the client disconnects while the work runs", async () => {
    let finishLexicon: (value: null) => void = () => {};
    lexicon.analyzeLexiconFor.mockImplementation(
      () => new Promise<null>((resolve) => (finishLexicon = resolve)),
    );
    const ctrl = new AbortController();
    const pending = nativeLexicon(request(LEXICON_URL, lexiconBody, ctrl));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lexicon.analyzeLexiconFor).toHaveBeenCalledTimes(1);
    ctrl.abort();
    finishLexicon(null);
    const response = await pending;
    expect(response.status).toBe(204);
  });

  it("drops a repair that finished for a disconnected client", async () => {
    let finishRepair: (value: null) => void = () => {};
    engine.runRepair.mockImplementation(
      () => new Promise<null>((resolve) => (finishRepair = resolve)),
    );
    const ctrl = new AbortController();
    const pending = nativeRepair(request(REPAIR_URL, repairBody, ctrl));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(engine.runRepair).toHaveBeenCalledTimes(1);
    ctrl.abort();
    finishRepair(null);
    expect((await pending).status).toBe(204);
  });

  it("aborts the outbound token request when the dictation caller disconnects", async () => {
    const ctrl = new AbortController();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = nativeDictation(
      new Request(DICTATION_URL, { method: "POST", headers, signal: ctrl.signal }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    ctrl.abort();
    expect((await pending).status).toBe(204);
    // The browser-side deadline and the caller cancellation share one signal, and that
    // signal is the one the provider fetch holds: the request was really cancelled.
    expect(fetchMock.mock.calls[0]![1]!.signal?.aborted).toBe(true);
  });

  it("does not call the provider for an already-cancelled dictation request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = new AbortController();
    ctrl.abort();
    const response = await nativeDictation(
      new Request(DICTATION_URL, { method: "POST", headers, signal: ctrl.signal }),
    );
    expect(response.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the calm failure contract for a real provider failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const response = await nativeDictation(new Request(DICTATION_URL, { method: "POST", headers }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false, status: 502 });
  });
});

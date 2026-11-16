import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWithRetry,
  isTransientStatus,
  retryDelayMs,
  MAX_PROVIDER_ATTEMPTS,
} from "./retry.server";
import { createDeepSeekProvider } from "./deepseek.server";
import type { TranslationRequest } from "../types";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const URL = "https://provider.example/chat";
const request: TranslationRequest = {
  text: "مرحبا",
  source: "ar",
  target: "de",
  style: "natural",
  dialect: "auto",
  brain: "deepseek",
  partial: false,
};

describe("bounded provider retry", () => {
  it("classifies only a bad provider moment as retryable", () => {
    for (const status of [429, 500, 502, 503, 504]) expect(isTransientStatus(status)).toBe(true);
    for (const status of [200, 201, 400, 401, 402, 403, 404, 422]) {
      expect(isTransientStatus(status)).toBe(false);
    }
    expect(MAX_PROVIDER_ATTEMPTS).toBe(2);
  });

  it("honours Retry-After seconds and HTTP-date, clamped to a short wait", () => {
    expect(retryDelayMs("2", 1)).toBe(2_000);
    expect(retryDelayMs("0", 1)).toBe(0);
    // Never hold the person for the two minutes a busy provider asks for.
    expect(retryDelayMs("120", 1)).toBe(2_500);
    const now = Date.parse("2026-01-01T00:00:00Z");
    // HTTP-dates have second resolution, so compare against a whole second.
    expect(retryDelayMs(new Date(now + 2_000).toUTCString(), 1, Math.random, () => now)).toBe(
      2_000,
    );
    expect(retryDelayMs(new Date(now - 5_000).toUTCString(), 1, Math.random, () => now)).toBe(0);
    // Absent or unparseable: exponential jitter of 200–600 ms for the single retry.
    expect(retryDelayMs("soon", 1, () => 0)).toBe(200);
    expect(retryDelayMs(null, 1, () => 0)).toBe(200);
    expect(retryDelayMs(undefined, 1, () => 1)).toBe(600);
  });

  it("retries one transient failure and returns the eventual success", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? new Response("busy", { status: 503, headers: { "Retry-After": "0" } })
            : new Response("ok", { status: 200 }),
        );
      }),
    );
    const response = await fetchWithRetry(URL, { method: "POST", body: "private sentence" });
    expect(calls).toBe(2);
    expect(response.status).toBe(200);
  });

  it("gives up after one retry and returns the last transient response", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return Promise.resolve(
          new Response("busy", { status: 503, headers: { "Retry-After": "0" } }),
        );
      }),
    );
    const response = await fetchWithRetry(URL, {});
    expect(calls).toBe(2);
    expect(response.status).toBe(503);
    void response.body?.cancel().catch(() => {});
  });

  it("retries once when the network fails before headers", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 200 ms, keeps the test fast
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new TypeError("fetch failed"))
          : Promise.resolve(new Response("ok", { status: 200 }));
      }),
    );
    const response = await fetchWithRetry(URL, {});
    expect(calls).toBe(2);
    expect(response.status).toBe(200);
  });

  it("never retries an auth or quota rejection", async () => {
    for (const status of [401, 402]) {
      let calls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(() => {
          calls += 1;
          return Promise.resolve(new Response("denied", { status }));
        }),
      );
      const response = await fetchWithRetry(URL, {});
      expect(response.status).toBe(status);
      expect(calls).toBe(1);
      vi.unstubAllGlobals();
    }
  });

  it("never retries when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return Promise.resolve(new Response(null, { status: 200 }));
      }),
    );
    await expect(fetchWithRetry(URL, {}, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(calls).toBe(0);
  });

  it("stops waiting for the retry when the caller aborts", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        // A real delay would be clamped; the abort must win before it elapses.
        return Promise.resolve(
          new Response("busy", { status: 503, headers: { "Retry-After": "2" } }),
        );
      }),
    );
    const controller = new AbortController();
    const pending = fetchWithRetry(URL, {}, controller.signal)
      .then(() => null)
      .catch((error: Error & { name: string }) => error);
    await vi.waitFor(() => expect(calls).toBe(1));
    controller.abort();
    const error = await pending;
    expect(error?.name).toBe("AbortError");
    expect(calls).toBe(1);
  });

  it("does not double a request that already hit the safety deadline", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return Promise.reject(new DOMException("Cancelled", "AbortError"));
      }),
    );
    await expect(fetchWithRetry(URL, {})).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });

  it("keeps the key, body and provider text out of the surfaced error", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return Promise.resolve(
          new Response("SECRET private sentence", {
            status: 500,
            headers: { "Retry-After": "0" },
          }),
        );
      }),
    );
    const error = (await createDeepSeekProvider("test-key")
      .translate(request)
      .then(() => null)
      .catch((e: Error & { kind?: string }) => e)) as (Error & { kind?: string }) | null;
    expect(calls).toBe(2); // one bounded retry, then the provider error
    expect(error?.kind).toBe("provider");
    expect(error?.message).not.toContain("SECRET");
    expect(error?.message).not.toContain("test-key");
    expect(error?.message).not.toContain(request.text);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { streamTranslate } from "./stream";

afterEach(() => vi.unstubAllGlobals());

describe("streamTranslate", () => {
  it("classifies the server's quiet 204 cancel as a cancellation, not a provider failure", async () => {
    // The translate-stream route answers 204 when the caller's own request was aborted
    // upstream. It carries no body, so reading it as JSON used to throw and surface a
    // "provider" error with a retry — a failure the person never caused.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const res = await streamTranslate({}, new AbortController().signal, () => {}, "live");
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ cancelled: true });
  });

  it("still reports a real error status with its kind", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: false, kind: "rate" }, { status: 429 })),
    );
    const res = await streamTranslate({}, new AbortController().signal, () => {}, "live");
    expect(res).toEqual({ ok: false, kind: "rate" });
  });
});

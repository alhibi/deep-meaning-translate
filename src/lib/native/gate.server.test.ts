import { afterEach, describe, expect, it, vi } from "vitest";
import {
  nativeEndpoint,
  nativeGate,
  nativeOrigins,
  nativePreflight,
  withNativeCors,
} from "./gate.server";

const app = "https://localhost";

function withOrigin(origin?: string): Request {
  const headers: Record<string, string> = {};
  if (origin) headers["Origin"] = origin;
  return new Request("https://fluently.today/api/native/v1/translate-stream", {
    method: "POST",
    headers,
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("the native origin allowlist", () => {
  it("is exact in production and never contains a wildcard", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(nativeOrigins()).toEqual(["https://localhost", "capacitor://localhost"]);
    expect(nativeOrigins()).not.toContain("*");
  });

  it("includes the browser preview origin only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(nativeOrigins()).toContain("http://localhost");
    vi.stubEnv("NODE_ENV", "production");
    expect(nativeOrigins()).not.toContain("http://localhost");
  });

  it("accepts operator additions from NATIVE_ALLOWED_ORIGINS", () => {
    vi.stubEnv("NATIVE_ALLOWED_ORIGINS", " https://android.example , ");
    expect(nativeOrigins()).toContain("https://android.example");
  });

  it("denies a missing, look-alike, port or case variant origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const origin of [
      undefined,
      "",
      "https://evil.example",
      "https://localhost.evil.example",
      "https://localhost:8443",
      "https://LOCALHOST",
      "capacitor://localhost.evil",
      "http://localhost",
    ]) {
      expect(nativeGate(withOrigin(origin))).toBeNull();
    }
  });

  it("accepts the packaged app's own origins and reflects only them", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const origin of [app, "capacitor://localhost"]) {
      const gate = nativeGate(withOrigin(origin));
      expect(gate?.origin).toBe(origin);
      expect(gate?.headers["Access-Control-Allow-Origin"]).toBe(origin);
      expect(gate?.headers["Vary"]).toBe("Origin");
    }
    vi.stubEnv("NODE_ENV", "production");
    const http = nativeGate(withOrigin("http://localhost"));
    expect(http).toBeNull();
  });
});

describe("the native gate's responses", () => {
  it("answers a preflight with 204 and no wildcard", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = nativePreflight(withOrigin(app));
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(app);
    expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
    // The app must be able to read who actually wrote a streamed answer (fallback-safe review).
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("X-Translation-Writer");
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("refuses a denied preflight without provider work", async () => {
    const response = nativePreflight(withOrigin("https://evil.example"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, kind: "input" });
  });

  it("merges its headers over a handler's response and keeps the body", async () => {
    const response = await nativeEndpoint(withOrigin(app), () =>
      Response.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(app);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("turns a thrown handler into a generic failure with no message", async () => {
    const response = await nativeEndpoint(withOrigin(app), () => {
      throw new Error("SECRET provider body");
    });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("SECRET");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(app);
  });

  it("keeps CORS headers on a 429 and on a 4xx handler response", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const rate = await nativeEndpoint(withOrigin(app), () =>
      Response.json({ ok: false, kind: "rate" }, { status: 429 }),
    );
    expect(rate.status).toBe(429);
    expect(rate.headers.get("Access-Control-Allow-Origin")).toBe(app);
    const bad = await nativeEndpoint(withOrigin(app), () =>
      Response.json({ ok: false, kind: "input" }, { status: 400 }),
    );
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBe(app);
    expect(bad.headers.get("Vary")).toBe("Origin");
  });

  it("does not attach a body to a 204", () => {
    const response = withNativeCors(
      new Response(null, { status: 204 }),
      nativeGate(withOrigin(app))!,
    );
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });
});

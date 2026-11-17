// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
import { BERLIN_METRIC, GEOCODE_BERLIN_AR } from "./fixtures";
import { Route as WebWeatherRoute } from "@/routes/api/weather";
import { Route as WebPlaceRoute } from "@/routes/api/weather/place";
import { Route as NativeWeatherRoute } from "@/routes/api/native/v1/weather";
import { Route as NativePlaceRoute } from "@/routes/api/native/v1/weather/place";

interface RouteShape {
  server: {
    handlers: Record<string, (args: { request: Request }) => Promise<Response> | Response>;
  };
}

const handlers = (route: unknown) => (route as unknown as RouteShape).server.handlers;

function weatherRequest(origin?: string): Request {
  return new Request("https://fluently.today/api/weather", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": `ip-${Math.random()}`,
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ latitude: 52.52, longitude: 13.41, units: "metric", lang: "de" }),
  });
}

function nativeWeatherRequest(origin?: string): Request {
  return new Request("https://fluently.today/api/native/v1/weather", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ latitude: 52.52, longitude: 13.41, units: "metric", lang: "de" }),
  });
}

function nativePlaceRequest(origin?: string): Request {
  return new Request("https://fluently.today/api/native/v1/weather/place", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ q: "Berlin", lang: "de" }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("method rejection", () => {
  it("answers 405 JSON for every non-POST method instead of falling through to SSR", async () => {
    for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE"]) {
      const web = await handlers(WebWeatherRoute)[method]!({
        request: new Request("https://fluently.today/api/weather", { method }),
      });
      expect(web.status).toBe(405);
      expect(web.headers.get("allow")).toBe("POST, OPTIONS");
      expect(web.headers.get("cache-control")).toBe("no-store");
      if (method !== "HEAD") expect(await web.json()).toEqual({ ok: false, kind: "input" });

      const place = await handlers(WebPlaceRoute)[method]!({
        request: new Request("https://fluently.today/api/weather/place", { method }),
      });
      expect(place.status).toBe(405);

      const native = await handlers(NativeWeatherRoute)[method]!({
        request: new Request("https://fluently.today/api/native/v1/weather", {
          method,
          headers: { Origin: "https://localhost" },
        }),
      });
      expect(native.status).toBe(405);

      const nativePlace = await handlers(NativePlaceRoute)[method]!({
        request: new Request("https://fluently.today/api/native/v1/weather/place", {
          method,
          headers: { Origin: "https://localhost" },
        }),
      });
      expect(nativePlace.status).toBe(405);
    }
  });
});

describe("web weather route", () => {
  it("refuses a cross-site request before any work", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await handlers(WebWeatherRoute)["POST"]!({
      request: weatherRequest("https://evil.example"),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, kind: "input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a same-origin request and delegates to the shared handler", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(BERLIN_METRIC), { status: 200 })),
    );
    const response = await handlers(WebWeatherRoute)["POST"]!({
      request: weatherRequest("https://fluently.today"),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = (await response.json()) as { ok: boolean };
    expect(payload.ok).toBe(true);
  });

  it("accepts a request without an Origin header (same-origin fetch) and refuses cross-site metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(BERLIN_METRIC), { status: 200 })),
    );
    const noOrigin = await handlers(WebWeatherRoute)["POST"]!({ request: weatherRequest() });
    expect(noOrigin.status).toBe(200);
    const crossSite = new Request("https://fluently.today/api/weather", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "cross-site",
        "X-Forwarded-For": `ip-${Math.random()}`,
      },
      body: JSON.stringify({ latitude: 52.52, longitude: 13.41 }),
    });
    const refused = await handlers(WebWeatherRoute)["POST"]!({ request: crossSite });
    expect(refused.status).toBe(403);
  });
});

describe("web place route", () => {
  it("refuses cross-site and answers same-origin", async () => {
    const cross = await handlers(WebPlaceRoute)["POST"]!({
      request: new Request("https://fluently.today/api/weather/place", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ q: "Berlin", lang: "de" }),
      }),
    });
    expect(cross.status).toBe(403);

    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(GEOCODE_BERLIN_AR), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const same = await handlers(WebPlaceRoute)["POST"]!({
      request: new Request("https://fluently.today/api/weather/place", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://fluently.today",
          "X-Forwarded-For": `ip-${Math.random()}`,
        },
        body: JSON.stringify({ q: "Berlin", lang: "ar" }),
      }),
    });
    expect(same.status).toBe(200);
    const payload = (await same.json()) as { ok: boolean; places: unknown[] };
    expect(payload.ok).toBe(true);
    expect(payload.places).toHaveLength(3);
  });
});

describe("native weather route (existing origin gate)", () => {
  it("refuses a request with no Origin and a foreign Origin", async () => {
    expect(
      (await handlers(NativeWeatherRoute)["POST"]!({ request: nativeWeatherRequest() })).status,
    ).toBe(403);
    expect(
      (
        await handlers(NativeWeatherRoute)["POST"]!({
          request: nativeWeatherRequest("https://evil.example"),
        })
      ).status,
    ).toBe(403);
    const foreignPlace = await handlers(NativePlaceRoute)["POST"]!({
      request: nativePlaceRequest("https://evil.example"),
    });
    expect(foreignPlace.status).toBe(403);
  });

  it("answers the allowed app origin with the CORS headers the APK needs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(BERLIN_METRIC), { status: 200 })),
    );
    const response = await handlers(NativeWeatherRoute)["POST"]!({
      request: nativeWeatherRequest("https://localhost"),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(response.headers.get("vary")).toContain("Origin");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = (await response.json()) as { ok: boolean };
    expect(payload.ok).toBe(true);
  });

  it("answers a preflight without touching a provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await handlers(NativeWeatherRoute)["OPTIONS"]!({
      request: new Request("https://fluently.today/api/native/v1/weather", {
        method: "OPTIONS",
        headers: { Origin: "https://localhost", "Access-Control-Request-Method": "POST" },
      }),
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves the same place contract to the app", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(GEOCODE_BERLIN_AR), { status: 200 })),
    );
    const response = await handlers(NativePlaceRoute)["POST"]!({
      request: nativePlaceRequest("https://localhost"),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://localhost");
    const payload = (await response.json()) as { ok: boolean; places: Array<{ name: string }> };
    expect(payload.places[0]?.name).toBe("برلين");
  });
});

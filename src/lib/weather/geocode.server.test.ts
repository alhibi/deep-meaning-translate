// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GEOCODE_BERLIN_AR, NOMINATIM_BERLIN_AR } from "./fixtures";
import {
  NOMINATIM_PLACE_CREDIT,
  NOMINATIM_USER_AGENT,
  PLACE_MAX_RESULTS,
  createNominatimQueue,
  createNominatimReverseGeocoder,
  handleWeatherPlaceRequest,
  mapGeocodingResults,
  mapNominatimPlace,
  resetReversePlaceCacheForTests,
  type ReverseGeocoder,
} from "./geocode.server";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function placeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://fluently.today/api/weather/place", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function clientIp(): Record<string, string> {
  return { "X-Forwarded-For": `ip-${Math.random()}` };
}

beforeEach(() => {
  resetReversePlaceCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("forward geocoding mapping", () => {
  it("maps the localized Berlin fixture to WeatherPlace", () => {
    const places = mapGeocodingResults(GEOCODE_BERLIN_AR);
    expect(places).toHaveLength(3);
    expect(places[0]).toEqual({
      id: "open-meteo:52.52:13.41",
      name: "برلين",
      latitude: 52.52,
      longitude: 13.41,
      countryCode: "DE",
      admin: "برلين",
      timeZone: "Europe/Berlin",
      source: "search",
    });
    expect(places[1]?.countryCode).toBe("US");
    expect(places[1]?.timeZone).toBe("America/New_York");
  });

  it("bounds and de-duplicates a hostile provider body", () => {
    const results = Array.from({ length: 40 }, (_, index) => ({
      name: `Place ${index}`,
      latitude: 40.123456,
      longitude: index % 2 === 0 ? 13.419 : 13.42,
      timezone: "Europe/Berlin",
      country_code: "de",
    }));
    const places = mapGeocodingResults({ results });
    expect(places.length).toBeLessThanOrEqual(PLACE_MAX_RESULTS);
    expect(places[0]?.latitude).toBe(40.12);
    const ids = places.map((place) => place.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("skips a result without a usable IANA timezone instead of inventing one", () => {
    expect(
      mapGeocodingResults({
        results: [
          { name: "Nowhere", latitude: 0, longitude: 0 },
          { name: "BadZone", latitude: 0, longitude: 1, timezone: "Not/AZone" },
          { name: "Berlin", latitude: 52.52, longitude: 13.41, timezone: "Europe/Berlin" },
        ],
      }),
    ).toEqual([
      {
        id: "open-meteo:52.52:13.41",
        name: "Berlin",
        latitude: 52.52,
        longitude: 13.41,
        timeZone: "Europe/Berlin",
        source: "search",
      },
    ]);
  });

  it("returns an empty list for garbage instead of throwing", () => {
    expect(mapGeocodingResults(null)).toEqual([]);
    expect(mapGeocodingResults({ results: "no" })).toEqual([]);
    expect(mapGeocodingResults({ results: [] })).toEqual([]);
  });
});

describe("Nominatim reverse mapping", () => {
  it("takes the settlement name and the required credit fields", () => {
    expect(mapNominatimPlace(NOMINATIM_BERLIN_AR)).toEqual({
      name: "برلين",
      countryCode: "DE",
    });
  });

  it("falls back to the first one or two display_name components", () => {
    expect(
      mapNominatimPlace({
        display_name: "Rural Hamlet, Some District, Some Region, Germany",
        address: { country_code: "de" },
      }),
    ).toEqual({ name: "Rural Hamlet, Some District", countryCode: "DE" });
  });

  it("bounds the name and refuses an empty result", () => {
    const long = "x".repeat(200);
    expect(mapNominatimPlace({ display_name: long })?.name).toHaveLength(80);
    expect(mapNominatimPlace({ display_name: " , , " })).toBeNull();
    expect(mapNominatimPlace({})).toBeNull();
    expect(mapNominatimPlace("nope")).toBeNull();
  });
});

describe("Nominatim adapter", () => {
  it("sends the identifying User-Agent and localized Accept-Language", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const geocoder = createNominatimReverseGeocoder({
      queue: createNominatimQueue(0),
      fetchImpl: async (url, init) => {
        calls.push({ url, ...(init ? { init } : {}) });
        return jsonResponse(NOMINATIM_BERLIN_AR);
      },
    });
    const label = await geocoder.reverse(52.52437, 13.41053, "ar");
    expect(label).toEqual({ name: "برلين", countryCode: "DE" });
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/reverse");
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect(url.searchParams.get("accept-language")).toBe("ar");
    expect(url.searchParams.get("lat")).toBe("52.52");
    expect(url.searchParams.get("lon")).toBe("13.41");
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(NOMINATIM_USER_AGENT);
  });

  it("resolves null on HTTP failure, timeout, network error and garbage", async () => {
    const build = (fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) =>
      createNominatimReverseGeocoder({ queue: createNominatimQueue(0), fetchImpl });
    expect(await build(async () => jsonResponse({}, 403)).reverse(52.52, 13.41, "de")).toBeNull();
    expect(await build(async () => new Response("<html>")).reverse(52.52, 13.41, "de")).toBeNull();
    expect(
      await build(async () => jsonResponse({ error: "Unable to geocode" })).reverse(
        52.52,
        13.41,
        "de",
      ),
    ).toBeNull();
    const thrower = build(async () => {
      throw new TypeError("network down");
    });
    expect(await thrower.reverse(52.52, 13.41, "de")).toBeNull();
    const timingOut = createNominatimReverseGeocoder({
      queue: createNominatimQueue(0),
      timeoutMs: 5,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("timed out", "AbortError")),
          );
        }),
    });
    expect(await timingOut.reverse(52.52, 13.41, "de")).toBeNull();
  });
});

describe("Nominatim rate queue", () => {
  it("serializes and spaces calls (one request per second policy)", async () => {
    const queue = createNominatimQueue(30);
    const started: number[] = [];
    const first = queue.schedule(async () => {
      started.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 1;
    });
    const second = queue.schedule(async () => {
      started.push(Date.now());
      return 2;
    });
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(started).toHaveLength(2);
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(28);
  });

  it("keeps the queue alive after a failing task", async () => {
    const queue = createNominatimQueue(0);
    await expect(queue.schedule(async () => Promise.reject(new Error("boom")))).rejects.toThrow();
    expect(await queue.schedule(async () => 7)).toBe(7);
  });
});

describe("place route handler", () => {
  const label = { name: "Berlin", countryCode: "DE", admin: "Berlin" };
  function reverseStub(labelValue: { name: string } | null = label) {
    const calls: number[] = [];
    const geocoder: ReverseGeocoder = {
      id: "test",
      async reverse(latitude, longitude) {
        calls.push(latitude);
        return labelValue;
      },
    };
    return { calls, geocoder };
  }
  const timeZoneFor = async () => "Europe/Berlin";

  it("answers forward search with bounded, localized places", async () => {
    const response = await handleWeatherPlaceRequest(
      placeRequest({ q: "Berlin", lang: "ar" }, clientIp()),
      { fetchImpl: async () => jsonResponse(GEOCODE_BERLIN_AR) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = (await response.json()) as {
      ok: boolean;
      places: Array<{ name: string; source: string; timeZone: string }>;
    };
    expect(payload.ok).toBe(true);
    expect(payload.places[0]?.name).toBe("برلين");
    expect(payload.places[0]?.source).toBe("search");
    expect(payload.places[0]?.timeZone).toBe("Europe/Berlin");
  });

  it("answers reverse with exactly one labelled place and the OSM credit", async () => {
    const { calls, geocoder } = reverseStub();
    const response = await handleWeatherPlaceRequest(
      placeRequest({ latitude: 52.52437, longitude: 13.41053, lang: "de" }, clientIp()),
      { reverseGeocoder: geocoder, timeZoneFor },
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok: boolean;
      places: Array<Record<string, unknown>>;
    };
    expect(payload.places).toEqual([
      {
        id: "open-meteo:52.52:13.41",
        name: "Berlin",
        latitude: 52.52,
        longitude: 13.41,
        countryCode: "DE",
        admin: "Berlin",
        timeZone: "Europe/Berlin",
        source: "geolocation",
        placeCredit: NOMINATIM_PLACE_CREDIT,
      },
    ]);
    expect(calls).toEqual([52.52]);
  });

  it("caches a resolved reverse label so a re-render does not re-hit Nominatim", async () => {
    const { calls, geocoder } = reverseStub();
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await handleWeatherPlaceRequest(
        placeRequest({ latitude: 52.52, longitude: 13.41, lang: "ar" }, clientIp()),
        { reverseGeocoder: geocoder, timeZoneFor },
      );
      expect(response.status).toBe(200);
    }
    expect(calls).toHaveLength(1);
  });

  it("returns an honest empty list when reverse or the timezone lookup fails", async () => {
    const failing = reverseStub(null);
    const noLabel = await handleWeatherPlaceRequest(
      placeRequest({ latitude: 48.14, longitude: 11.58, lang: "de" }, clientIp()),
      { reverseGeocoder: failing.geocoder, timeZoneFor },
    );
    expect(await noLabel.json()).toEqual({ ok: true, places: [] });

    const withLabel = reverseStub();
    const noZone = await handleWeatherPlaceRequest(
      placeRequest({ latitude: 48.14, longitude: 11.58, lang: "de" }, clientIp()),
      { reverseGeocoder: withLabel.geocoder, timeZoneFor: async () => null },
    );
    expect(await noZone.json()).toEqual({ ok: true, places: [] });
  });

  it("refuses mixed, missing or malformed bodies as input", async () => {
    const bodies: unknown[] = [
      {},
      { q: "Berlin" },
      { q: "Berlin", latitude: 52.52, longitude: 13.41, lang: "de" },
      { q: "Berlin", lang: "de", latitude: 52.52 },
      { latitude: 52.52, longitude: 13.41 },
      { latitude: 999, longitude: 13.41, lang: "de" },
      { q: "   ", lang: "de" },
      { q: "x".repeat(81), lang: "de" },
      { q: "Berlin", lang: "fr" },
      { mode: "reverse", q: "Berlin", lang: "de" },
    ];
    for (const body of bodies) {
      const response = await handleWeatherPlaceRequest(placeRequest(body, clientIp()));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ ok: false, kind: "input" });
    }
  });

  it("accepts 80 code points even when they exceed 80 UTF-16 units", async () => {
    const q = "😀".repeat(80); // 160 UTF-16 units, 80 code points
    const response = await handleWeatherPlaceRequest(placeRequest({ q, lang: "de" }, clientIp()), {
      fetchImpl: async () => jsonResponse({}),
    });
    expect(response.status).toBe(200);
  });

  it("bounds an oversized body before parsing", async () => {
    const response = await handleWeatherPlaceRequest(
      new Request("https://fluently.today/api/weather/place", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...clientIp() },
        body: "x".repeat(200_000),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("maps upstream statuses to the place error contract", async () => {
    const rate = await handleWeatherPlaceRequest(
      placeRequest({ q: "Berlin", lang: "de" }, clientIp()),
      {
        fetchImpl: async () => jsonResponse({}, 429),
      },
    );
    expect(rate.status).toBe(429);
    expect(await rate.json()).toEqual({ ok: false, kind: "rate" });
    const provider = await handleWeatherPlaceRequest(
      placeRequest({ q: "Berlin", lang: "de" }, clientIp()),
      { fetchImpl: async () => jsonResponse({}, 500) },
    );
    expect(provider.status).toBe(502);
    expect(await provider.json()).toEqual({ ok: false, kind: "provider" });
    const network = await handleWeatherPlaceRequest(
      placeRequest({ q: "Berlin", lang: "de" }, clientIp()),
      {
        fetchImpl: async () => {
          throw new TypeError("network down");
        },
      },
    );
    expect(network.status).toBe(502);
    expect(await network.json()).toEqual({ ok: false, kind: "network" });
  });

  it("spends its own purpose budget", async () => {
    const ip = `rate-${Math.random()}`;
    const fetchImpl = async () => jsonResponse({ results: [] });
    let last: Response | null = null;
    for (let attempt = 0; attempt < 21; attempt++) {
      last = await handleWeatherPlaceRequest(
        placeRequest({ q: "Berlin", lang: "de" }, { "X-Forwarded-For": ip }),
        { fetchImpl },
      );
    }
    expect(last?.status).toBe(429);
    expect(await last?.json()).toEqual({ ok: false, kind: "rate" });
  });

  it("logs no query text, place name or coordinate", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { geocoder } = reverseStub();
    await handleWeatherPlaceRequest(
      placeRequest({ latitude: 52.52, longitude: 13.41, lang: "de" }, clientIp()),
      {
        reverseGeocoder: geocoder,
        timeZoneFor,
      },
    );
    await handleWeatherPlaceRequest(placeRequest({ q: "Berlin", lang: "de" }, clientIp()), {
      fetchImpl: async () => jsonResponse(GEOCODE_BERLIN_AR),
    });
    const lines = info.mock.calls.map((call) => String(call[0]));
    info.mockRestore();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain("52.52");
      expect(line).not.toContain("Berlin");
      expect(line).not.toContain("برلين");
      expect(line).toContain('"event":"weather-place"');
    }
  });
});

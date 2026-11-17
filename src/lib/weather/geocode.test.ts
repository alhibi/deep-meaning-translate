import { afterEach, describe, expect, it, vi } from "vitest";
import {
  coarseCoordinates,
  createPlaceClient,
  fetchPlaceCandidates,
  httpStatusKind,
  normalizePlaceLanguage,
  normalizePlaceQuery,
  parsePlacesEnvelope,
  placeIdentity,
  PLACE_RESULTS_MAX,
  PLACE_TIMEOUT_MS,
  PlaceError,
  roundCoordinate,
  sanitizePlace,
  WEB_PLACE_ROUTE,
  type PlaceRequest,
  type WeatherPlaceCandidate,
} from "./geocode";
import type { WeatherPlace } from "./types";

function candidate(overrides: Partial<WeatherPlace> = {}): WeatherPlace {
  return {
    id: "open-meteo:52.52:13.40",
    name: "Berlin",
    latitude: 52.52,
    longitude: 13.4,
    timeZone: "Europe/Berlin",
    countryCode: "DE",
    admin: "Berlin",
    ...overrides,
  };
}

const envelope = (places: unknown[]): unknown => ({ ok: true, places });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("coordinate quantization", () => {
  it("rounds to two decimals and normalizes negative zero", () => {
    expect(roundCoordinate(52.5201234)).toBe(52.52);
    expect(roundCoordinate(13.4049876)).toBe(13.4);
    expect(roundCoordinate(-33.865143)).toBe(-33.87);
    expect(Object.is(roundCoordinate(-0.001), 0)).toBe(true);
    expect(roundCoordinate(roundCoordinate(52.5201234))).toBe(52.52);
  });

  it("rejects coordinates that are not finite or are out of range", () => {
    expect(coarseCoordinates(Number.NaN, 13.4)).toBeNull();
    expect(coarseCoordinates(52.52, Number.POSITIVE_INFINITY)).toBeNull();
    expect(coarseCoordinates(90.5, 13.4)).toBeNull();
    expect(coarseCoordinates(52.52, 180.5)).toBeNull();
    expect(coarseCoordinates("52.52", 13.4)).toBeNull();
    expect(coarseCoordinates(null, null)).toBeNull();
  });

  it("accepts the coordinate boundaries after rounding", () => {
    expect(coarseCoordinates(90, -180)).toEqual({ latitude: 90, longitude: -180 });
    expect(coarseCoordinates(-90, 180)).toEqual({ latitude: -90, longitude: 180 });
  });

  it("derives A06's cache identity from rounded coordinates", () => {
    expect(placeIdentity(52.5201234, 13.4049876)).toBe("open-meteo:52.52:13.40");
    expect(placeIdentity(-33.865143, 151.2099)).toBe("open-meteo:-33.87:151.21");
  });
});

describe("query and language normalization", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizePlaceQuery("  New   York ")).toBe("New York");
    expect(normalizePlaceQuery("\n Berlin\t")).toBe("Berlin");
  });

  it("rejects empty and overlong queries by code point", () => {
    expect(normalizePlaceQuery("")).toBeNull();
    expect(normalizePlaceQuery("   ")).toBeNull();
    expect(normalizePlaceQuery(42)).toBeNull();
    expect(normalizePlaceQuery("a".repeat(80))).toBe("a".repeat(80));
    expect(normalizePlaceQuery("a".repeat(81))).toBeNull();
    // 40 emoji are 40 code points but 80 UTF-16 units: the bound is on code points, so
    // an emoji is never cut in half and the visual length is what is bounded.
    expect(normalizePlaceQuery("😀".repeat(40))).toBe("😀".repeat(40));
    expect(normalizePlaceQuery("😀".repeat(80))).toBe("😀".repeat(80));
    expect(normalizePlaceQuery("😀".repeat(81))).toBeNull();
  });

  it("only accepts the three localized languages and falls back to English", () => {
    for (const language of ["ar", "de", "en"] as const) {
      expect(normalizePlaceLanguage(language)).toBe(language);
    }
    expect(normalizePlaceLanguage("fr")).toBe("en");
    expect(normalizePlaceLanguage(null)).toBe("en");
  });
});

describe("place parsing", () => {
  it("re-rounds server coordinates and keeps optional fields", () => {
    const place = sanitizePlace({
      ...candidate(),
      latitude: 52.5201234,
      longitude: 13.4049876,
      source: "geolocation",
      placeCredit: "© OpenStreetMap contributors",
    });
    expect(place).not.toBeNull();
    expect(place?.latitude).toBe(52.52);
    expect(place?.longitude).toBe(13.4);
    expect(place?.countryCode).toBe("DE");
    expect(place?.admin).toBe("Berlin");
    expect(place?.source).toBe("geolocation");
    expect(place?.placeCredit).toBe("© OpenStreetMap contributors");
  });

  it("drops a place with an unusable id, name, timezone or coordinate", () => {
    expect(sanitizePlace(candidate({ id: "" }))).toBeNull();
    expect(sanitizePlace(candidate({ id: "bad\u0000id" }))).toBeNull();
    expect(sanitizePlace(candidate({ name: "   " }))).toBeNull();
    expect(sanitizePlace(candidate({ timeZone: "" }))).toBeNull();
    expect(sanitizePlace({ ...candidate(), latitude: 200 })).toBeNull();
    expect(sanitizePlace(null)).toBeNull();
    expect(sanitizePlace("place")).toBeNull();
  });

  it("keeps the place but drops an invalid country code or source", () => {
    const place = sanitizePlace({
      ...candidate({ countryCode: "deutschland", id: "open-meteo:52.52:13.40" }),
      source: "somewhere",
      placeCredit: 42,
    });
    expect(place).not.toBeNull();
    expect(place?.countryCode).toBeUndefined();
    expect(place?.source).toBeUndefined();
    expect(place?.placeCredit).toBeUndefined();
  });

  it("reads the success envelope and drops invalid candidates", () => {
    const places = parsePlacesEnvelope(
      envelope([candidate(), { ...candidate(), name: "" }, candidate({ id: "x" })]),
    );
    expect(places).toHaveLength(2);
    expect(places?.[1]?.id).toBe("x");
  });

  it("rejects non-envelopes and non-arrays but accepts an empty list", () => {
    expect(parsePlacesEnvelope({ ok: false, kind: "input" })).toBeNull();
    expect(parsePlacesEnvelope([candidate()])).toBeNull();
    expect(parsePlacesEnvelope({ ok: true, places: "x" })).toBeNull();
    expect(parsePlacesEnvelope(null)).toBeNull();
    expect(parsePlacesEnvelope(envelope([]))).toEqual([]);
  });

  it("never returns more than eight candidates", () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      candidate({ id: `open-meteo:${52 + index / 100}:13.40` }),
    );
    expect(parsePlacesEnvelope(envelope(many))).toHaveLength(PLACE_RESULTS_MAX);
  });
});

describe("place client over an injected fetch", () => {
  it("posts the exact forward shape with the interface language", async () => {
    const requests: PlaceRequest[] = [];
    const client = createPlaceClient(async (request) => {
      requests.push(request);
      return envelope([candidate()]);
    });
    const places = await client.search("  Berlin ", "ar");
    expect(requests).toEqual([{ q: "Berlin", lang: "ar" }]);
    expect(places).toHaveLength(1);
    expect(places[0]?.name).toBe("Berlin");
  });

  it("sends only two-decimal coordinates in reverse requests", async () => {
    const requests: PlaceRequest[] = [];
    const client = createPlaceClient(async (request) => {
      requests.push(request);
      return envelope([]);
    });
    await client.reverse(52.5201234, 13.4049876, "de");
    expect(requests).toEqual([{ latitude: 52.52, longitude: 13.4, lang: "de" }]);
  });

  it("returns an empty list when the server knows no locality", async () => {
    const client = createPlaceClient(async () => envelope([]));
    await expect(client.reverse(52.52, 13.4)).resolves.toEqual([]);
    await expect(client.search("Nowhere")).resolves.toEqual([]);
  });

  it("rejects an invalid query or coordinate without opening a request", async () => {
    const fetchMock = vi.fn(async () => envelope([]));
    const client = createPlaceClient(fetchMock);
    await expect(client.search("   ")).rejects.toMatchObject({ kind: "input" });
    await expect(client.reverse(Number.NaN, 13.4)).rejects.toMatchObject({ kind: "input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a payload that is not the success envelope", async () => {
    const client = createPlaceClient(async () => ({ ok: false, kind: "provider" }));
    await expect(client.search("Berlin")).rejects.toMatchObject({
      name: "PlaceError",
      kind: "provider",
    });
  });

  it("maps an injected transport failure by kind", async () => {
    const client = createPlaceClient(async () => {
      throw Object.assign(new Error("rate"), { kind: "rate" });
    });
    await expect(client.search("Berlin")).rejects.toMatchObject({ kind: "rate" });
  });

  it("does not call fetch for an already-aborted signal", async () => {
    const fetchMock = vi.fn(async () => envelope([candidate()]));
    const client = createPlaceClient(fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(client.search("Berlin", "en", controller.signal)).rejects.toMatchObject({
      kind: "aborted",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("default web transport", () => {
  it("posts to our same-origin route and returns the envelope", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(envelope([candidate()])));
    vi.stubGlobal("fetch", fetchMock);
    const client = createPlaceClient();
    const places = await client.search("Berlin", "de");
    expect(places[0]?.name).toBe("Berlin");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WEB_PLACE_ROUTE);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual({ q: "Berlin", lang: "de" });
  });

  it("maps server error envelopes and statuses to typed kinds", async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { ok: false, kind: "input" }, "input"],
      [429, { ok: false, kind: "rate" }, "rate"],
      [504, { ok: false, kind: "timeout" }, "timeout"],
      [502, { ok: false, kind: "provider" }, "provider"],
      [502, { ok: false, kind: "network" }, "network"],
      [500, "not json", "provider"],
    ];
    for (const [status, body, kind] of cases) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          body === "not json" ? new Response("oops", { status }) : jsonResponse(body, status),
        ),
      );
      await expect(createPlaceClient().search("Berlin")).rejects.toMatchObject({ kind });
    }
  });

  it("maps a rejected fetch to network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(createPlaceClient().search("Berlin")).rejects.toMatchObject({ kind: "network" });
  });

  it("bounds a hung request and aborts the underlying fetch", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = createPlaceClient().search("Berlin");
    const assertion = expect(pending).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(PLACE_TIMEOUT_MS);
    await assertion;
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps httpStatusKind total for statuses without a server kind", () => {
    expect(httpStatusKind(400, null)).toBe("input");
    expect(httpStatusKind(403, null)).toBe("input");
    expect(httpStatusKind(429, null)).toBe("rate");
    expect(httpStatusKind(504, null)).toBe("timeout");
    expect(httpStatusKind(503, null)).toBe("provider");
    expect(httpStatusKind(200, "network")).toBe("network");
  });
});

describe("PlaceError carries no values", () => {
  it("only exposes a kind as its message", () => {
    const error = new PlaceError("provider");
    expect(error.message).toBe("provider");
    expect(error.name).toBe("PlaceError");
  });
});

describe("candidate type", () => {
  it("is the shared WeatherPlace shape", () => {
    const value: WeatherPlaceCandidate = candidate();
    expect(value.id).toBeTruthy();
  });
});

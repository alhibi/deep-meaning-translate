// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BERLIN_METRIC,
  CAIRO_METRIC_AR,
  REVERSE_TIMEZONE_MINIMAL,
  YAKUTSK_IMPERIAL,
} from "./fixtures";
import {
  OPEN_METEO_ATTRIBUTION,
  WEATHER_UPSTREAM_TIMEOUT_MS,
  buildOpenMeteoForecastUrl,
  configuredForecastUrl,
  createOpenMeteoProvider,
  formatDateInZone,
  formatIsoInZone,
  handleWeatherRequest,
  isValidTimeZone,
  normalizeOpenMeteoForecast,
  wmoSymbol,
} from "./openMeteo.server";
import { WeatherError } from "./provider";
import type { WeatherProvider, WeatherQuery } from "./types";
import { WEATHER_SCHEMA_VERSION } from "./types";

const BERLIN: WeatherQuery = { latitude: 52.52, longitude: 13.41, units: "metric", language: "de" };
const CAIRO: WeatherQuery = { latitude: 30.04, longitude: 31.24, units: "metric", language: "ar" };
const YAKUTSK: WeatherQuery = {
  latitude: 62.03,
  longitude: 129.73,
  units: "imperial",
  language: "de",
};
const FETCHED_AT = 1_794_936_600_000;

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function stubbedFetch(body: unknown, status = 200) {
  const calls: FetchCall[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { calls, fetchImpl };
}

function providerFor(body: unknown, options: { now?: () => number; status?: number } = {}) {
  const { calls, fetchImpl } = stubbedFetch(body, options.status ?? 200);
  return {
    calls,
    provider: createOpenMeteoProvider({ fetchImpl, now: options.now ?? (() => FETCHED_AT) }),
  };
}

function expectKind(error: unknown, kind: string) {
  expect(error).toBeInstanceOf(WeatherError);
  expect((error as WeatherError).kind).toBe(kind);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("WMO symbol table", () => {
  it("maps the provider's documented codes and keeps unknown codes honest", () => {
    expect(wmoSymbol(0)).toBe("clear");
    expect(wmoSymbol(1)).toBe("clear");
    expect(wmoSymbol(2)).toBe("partly-cloudy");
    expect(wmoSymbol(3)).toBe("cloudy");
    expect(wmoSymbol(45)).toBe("fog");
    expect(wmoSymbol(51)).toBe("drizzle");
    expect(wmoSymbol(56)).toBe("sleet");
    expect(wmoSymbol(63)).toBe("rain");
    expect(wmoSymbol(65)).toBe("heavy-rain");
    expect(wmoSymbol(71)).toBe("snow");
    expect(wmoSymbol(77)).toBe("snow");
    expect(wmoSymbol(82)).toBe("heavy-rain");
    expect(wmoSymbol(95)).toBe("thunder");
    expect(wmoSymbol(999)).toBe("unknown");
  });
});

describe("timezone-correct formatting", () => {
  it("writes the offset that is in force at that instant (DST fall-back in Berlin)", () => {
    expect(formatIsoInZone(Date.UTC(2026, 9, 24, 23, 30) / 1000, "Europe/Berlin")).toBe(
      "2026-10-25T01:30:00+02:00",
    );
    expect(formatIsoInZone(Date.UTC(2026, 9, 25, 0, 30) / 1000, "Europe/Berlin")).toBe(
      "2026-10-25T02:30:00+02:00",
    );
    expect(formatIsoInZone(Date.UTC(2026, 9, 25, 1, 30) / 1000, "Europe/Berlin")).toBe(
      "2026-10-25T02:30:00+01:00",
    );
  });

  it("handles a positive and a negative offset and a local day boundary", () => {
    expect(formatIsoInZone(1_794_934_800, "Asia/Yakutsk")).toBe("2026-11-18T02:00:00+09:00");
    expect(formatIsoInZone(1_794_934_800, "America/New_York")).toBe("2026-11-17T12:00:00-05:00");
    // 02:00Z on the 18th is still the 17th in New York: the local date must not roll over.
    expect(formatDateInZone(Date.UTC(2026, 10, 18, 2, 0) / 1000, "America/New_York")).toBe(
      "2026-11-17",
    );
    expect(formatDateInZone(Date.UTC(2026, 10, 17, 15, 0) / 1000, "Asia/Yakutsk")).toBe(
      "2026-11-18",
    );
  });

  it("rejects an invalid IANA zone", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});

describe("Open-Meteo request", () => {
  it("requests everything the snapshot needs, in the requested units", () => {
    const url = new URL(buildOpenMeteoForecastUrl({ ...BERLIN, units: "imperial" }));
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("52.52");
    expect(url.searchParams.get("longitude")).toBe("13.41");
    expect(url.searchParams.get("timezone")).toBe("auto");
    expect(url.searchParams.get("forecast_days")).toBe("7");
    expect(url.searchParams.get("timeformat")).toBe("unixtime");
    expect(url.searchParams.get("temperature_unit")).toBe("fahrenheit");
    expect(url.searchParams.get("wind_speed_unit")).toBe("mph");
    expect(url.searchParams.get("precipitation_unit")).toBe("inch");
    expect(url.searchParams.get("lang")).toBe("de");
    expect(url.searchParams.get("current")).toContain("weather_code");
    expect(url.searchParams.get("hourly")).toContain("precipitation_probability");
    expect(url.searchParams.get("daily")).toContain("sunrise");
    const metric = new URL(buildOpenMeteoForecastUrl(BERLIN));
    expect(metric.searchParams.get("temperature_unit")).toBe("celsius");
    expect(metric.searchParams.get("wind_speed_unit")).toBe("kmh");
  });

  it("rounds coordinates to two decimals before they leave the process", () => {
    const url = new URL(
      buildOpenMeteoForecastUrl({ ...BERLIN, latitude: 52.52437, longitude: 13.41053 }),
    );
    expect(url.searchParams.get("latitude")).toBe("52.52");
    expect(url.searchParams.get("longitude")).toBe("13.41");
  });

  it("keeps the endpoint a validated configuration seam, not a UI choice", () => {
    expect(configuredForecastUrl()).toBe("https://api.open-meteo.com/v1/forecast");
    vi.stubEnv("OPEN_METEO_FORECAST_URL", "https://customer-api.open-meteo.com/v1/forecast");
    expect(configuredForecastUrl()).toBe("https://customer-api.open-meteo.com/v1/forecast");
    vi.stubEnv("OPEN_METEO_FORECAST_URL", "http://evil.example/v1/forecast");
    expect(configuredForecastUrl()).toBe("https://api.open-meteo.com/v1/forecast");
    vi.stubEnv("OPEN_METEO_FORECAST_URL", "https://api.open-meteo.com/other");
    expect(configuredForecastUrl()).toBe("https://api.open-meteo.com/v1/forecast");
  });
});

describe("normalization from recorded provider bodies", () => {
  it("maps the Berlin metric fixture into the contract", async () => {
    const { provider, calls } = providerFor(BERLIN_METRIC);
    const snapshot = await provider.forecast(BERLIN);
    expect(calls).toHaveLength(1);
    expect(snapshot.version).toBe(WEATHER_SCHEMA_VERSION);
    expect(snapshot.provider).toBe("open-meteo");
    expect(snapshot.units).toBe("metric");
    expect(snapshot.fetchedAt).toBe(FETCHED_AT);
    expect(snapshot.expiresAt).toBeUndefined();
    expect(snapshot.place).toEqual({
      id: "open-meteo:52.52:13.41",
      name: "",
      latitude: 52.52,
      longitude: 13.41,
      timeZone: "Europe/Berlin",
    });
    expect(snapshot.current).toEqual({
      time: "2026-11-17T18:00:00+01:00",
      temperature: 5.3,
      apparentTemperature: 1.7,
      humidity: 88,
      windSpeed: 14.8,
      windDirection: 129,
      symbol: "rain",
      isDay: false,
    });
    expect(snapshot.attribution).toEqual(OPEN_METEO_ATTRIBUTION);
    expect(snapshot.attribution.license).toBe("CC BY 4.0");
    expect(snapshot.attribution.licenseUrl).toBe("https://creativecommons.org/licenses/by/4.0/");
  });

  it("starts the 48-hour series at the observation's hour and keeps the local offset", async () => {
    const { provider } = providerFor(BERLIN_METRIC);
    const snapshot = await provider.forecast(BERLIN);
    expect(snapshot.hourly).toHaveLength(48);
    expect(snapshot.hourly[0]?.time).toBe(snapshot.current.time);
    expect(snapshot.hourly[0]?.temperature).toBe(5.3);
    expect(snapshot.hourly[1]?.time).toBe("2026-11-17T19:00:00+01:00");
    expect(snapshot.hourly.every((hour) => hour.time.endsWith("+01:00"))).toBe(true);
    // The provider's 168-hour body is bounded to the contract's 48 (cache validator cap).
    expect(snapshot.hourly.at(-1)?.time).toBe("2026-11-19T17:00:00+01:00");
  });

  it("maps the seven daily rows to local calendar dates", async () => {
    const { provider } = providerFor(BERLIN_METRIC);
    const snapshot = await provider.forecast(BERLIN);
    expect(snapshot.daily).toHaveLength(7);
    expect(snapshot.daily.map((day) => day.date)).toEqual([
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
      "2026-11-23",
    ]);
    expect(snapshot.daily[0]).toEqual({
      date: "2026-11-17",
      min: 4.7,
      max: 8.8,
      precipitationProbability: 100,
      symbol: "rain",
      sunrise: "2026-11-17T07:31:30+01:00",
      sunset: "2026-11-17T16:10:29+01:00",
    });
  });

  it("handles the Arabic-region Cairo fixture with its +02:00 zone", async () => {
    const { provider } = providerFor(CAIRO_METRIC_AR);
    const snapshot = await provider.forecast(CAIRO);
    expect(snapshot.place.timeZone).toBe("Africa/Cairo");
    expect(snapshot.current.temperature).toBe(22.5);
    expect(snapshot.current.symbol).toBe("partly-cloudy");
    expect(snapshot.current.time).toBe("2026-11-17T19:00:00+02:00");
    expect(snapshot.daily[0]?.date).toBe("2026-11-17");
    expect(snapshot.daily[0]?.max).toBe(25.6);
  });

  it("keeps the imperial fixture's provider units and negative values", async () => {
    const { provider } = providerFor(YAKUTSK_IMPERIAL);
    const snapshot = await provider.forecast(YAKUTSK);
    expect(snapshot.units).toBe("imperial");
    expect(snapshot.place.timeZone).toBe("Asia/Yakutsk");
    expect(snapshot.current.temperature).toBe(-32.2);
    expect(snapshot.current.apparentTemperature).toBe(-39.9);
    expect(snapshot.current.time).toBe("2026-11-18T02:00:00+09:00");
    expect(snapshot.daily[0]?.date).toBe("2026-11-18");
    expect(snapshot.daily[0]?.min).toBe(-32.5);
    expect(snapshot.daily[2]?.symbol).toBe("snow");
  });

  it("never returns a partial snapshot: any broken required field rejects the body", async () => {
    const cases: Array<[string, (body: Record<string, unknown>) => void]> = [
      [
        "missing current temperature",
        (body) => delete (body["current"] as Record<string, unknown>)["temperature_2m"],
      ],
      ["missing is_day", (body) => delete (body["current"] as Record<string, unknown>)["is_day"]],
      [
        "hourly arrays disagree",
        (body) => {
          const hourly = body["hourly"] as Record<string, unknown[]>;
          hourly["weather_code"] = (hourly["weather_code"] ?? []).slice(0, -1);
        },
      ],
      [
        "a null daily temperature",
        (body) => {
          const daily = body["daily"] as Record<string, unknown[]>;
          (daily["temperature_2m_min"] as unknown[])[0] = null;
        },
      ],
      [
        "no daily rows",
        (body) => {
          body["daily"] = {
            time: [],
            weather_code: [],
            temperature_2m_max: [],
            temperature_2m_min: [],
          };
        },
      ],
      ["invalid timezone", (body) => (body["timezone"] = "Not/AZone")],
      ["invalid is_day", (body) => ((body["current"] as Record<string, unknown>)["is_day"] = 7)],
    ];
    for (const [label, mutate] of cases) {
      const body = JSON.parse(JSON.stringify(BERLIN_METRIC)) as Record<string, unknown>;
      mutate(body);
      const { provider } = providerFor(body);
      await expect(provider.forecast(BERLIN), label).rejects.toMatchObject({ kind: "invalid" });
    }
  });

  it("rejects a non-JSON body and an oversized body", async () => {
    const invalidJson = createOpenMeteoProvider({
      fetchImpl: async () => new Response("not json", { status: 200 }),
    });
    await expect(invalidJson.forecast(BERLIN)).rejects.toMatchObject({ kind: "invalid" });
    const huge = createOpenMeteoProvider({
      fetchImpl: async () => new Response("x".repeat(600 * 1024), { status: 200 }),
    });
    await expect(huge.forecast(BERLIN)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("classifies upstream HTTP statuses without leaking them", async () => {
    const cases: Array<[number, string]> = [
      [429, "rate"],
      [500, "provider"],
      [503, "provider"],
      [400, "invalid"],
      [404, "invalid"],
    ];
    for (const [status, kind] of cases) {
      const { provider } = providerFor({ error: true }, { status });
      await expect(provider.forecast(BERLIN), String(status)).rejects.toMatchObject({ kind });
    }
  });

  it("times out and reports a timeout, not a network error", async () => {
    const hang = createOpenMeteoProvider({
      timeoutMs: 5,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("timed out", "AbortError")),
          );
        }),
    });
    await expect(hang.forecast(BERLIN)).rejects.toMatchObject({ kind: "timeout" });
  });

  it("treats the caller's own abort as a quiet cancellation", async () => {
    const controller = new AbortController();
    const hang = createOpenMeteoProvider({
      timeoutMs: 5_000,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          if (init?.signal?.aborted) reject(new DOMException("aborted", "AbortError"));
        }),
    });
    const result = hang.forecast(BERLIN, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("normalizes a raw body directly and refuses the forecast-less timezone probe body", () => {
    const snapshot = normalizeOpenMeteoForecast(BERLIN_METRIC, BERLIN, FETCHED_AT);
    expect(snapshot.current.symbol).toBe("rain");
    // The one-day timezone probe has no hourly/daily arrays: it must be refused whole.
    expect(() => normalizeOpenMeteoForecast(REVERSE_TIMEZONE_MINIMAL, BERLIN, FETCHED_AT)).toThrow(
      WeatherError,
    );
  });
});

function weatherRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://fluently.today/api/weather", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { latitude: 52.52, longitude: 13.41, units: "metric", lang: "de" };

describe("weather route handler", () => {
  it("answers 200 with a validated snapshot and no-store caching", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(BERLIN_METRIC), { status: 200 })),
    );
    const response = await handleWeatherRequest(
      weatherRequest(VALID_BODY, { "X-Forwarded-For": `ip-${Math.random()}` }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const payload = (await response.json()) as {
      ok: boolean;
      snapshot: { current: { temperature: number } };
    };
    expect(payload.ok).toBe(true);
    expect(payload.snapshot.current.temperature).toBe(5.3);
  });

  it("refuses an invalid or over-specified body as input before any provider call", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    for (const body of [
      { latitude: 999, longitude: 13.41 },
      { latitude: 52.52 },
      { ...VALID_BODY, extra: true },
      { ...VALID_BODY, units: "kelvin" },
      { ...VALID_BODY, lang: "fr" },
    ]) {
      const response = await handleWeatherRequest(
        weatherRequest(body, { "X-Forwarded-For": `ip-${Math.random()}` }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, kind: "input" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("spends its own purpose budget and answers 429 after the burst", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(BERLIN_METRIC), { status: 200 })),
    );
    const ip = `rate-${Math.random()}`;
    let last: Response | null = null;
    for (let attempt = 0; attempt < 31; attempt++) {
      last = await handleWeatherRequest(weatherRequest(VALID_BODY, { "X-Forwarded-For": ip }));
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).toBe("60");
    expect(await last?.json()).toEqual({ ok: false, kind: "rate" });
  });

  it("maps provider failures to calm statuses and never to a partial snapshot", async () => {
    const provider: WeatherProvider = {
      id: "open-meteo",
      attribution: OPEN_METEO_ATTRIBUTION,
      forecast: async () => {
        throw new WeatherError("invalid");
      },
    };
    const response = await handleWeatherRequest(
      weatherRequest(VALID_BODY, { "X-Forwarded-For": `ip-${Math.random()}` }),
      provider,
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, kind: "invalid" });
  });

  it("answers 504 for a deadline and 204 for a cancelled request", async () => {
    const timeoutProvider: WeatherProvider = {
      id: "open-meteo",
      attribution: OPEN_METEO_ATTRIBUTION,
      forecast: async () => {
        throw new WeatherError("timeout");
      },
    };
    const timedOut = await handleWeatherRequest(
      weatherRequest(VALID_BODY, { "X-Forwarded-For": `ip-${Math.random()}` }),
      timeoutProvider,
    );
    expect(timedOut.status).toBe(504);
    expect(WEATHER_UPSTREAM_TIMEOUT_MS).toBe(5000);

    const cancelledProvider: WeatherProvider = {
      id: "open-meteo",
      attribution: OPEN_METEO_ATTRIBUTION,
      forecast: async () => {
        throw new WeatherError("cancelled");
      },
    };
    const cancelled = await handleWeatherRequest(
      weatherRequest(VALID_BODY, { "X-Forwarded-For": `ip-${Math.random()}` }),
      cancelledProvider,
    );
    expect(cancelled.status).toBe(204);
  });

  it("logs no coordinates, place names or query text", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(BERLIN_METRIC), { status: 200 })),
    );
    await handleWeatherRequest(
      weatherRequest(VALID_BODY, { "X-Forwarded-For": `ip-${Math.random()}` }),
    );
    const lines = info.mock.calls.map((call) => String(call[0]));
    info.mockRestore();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain("52.52");
      expect(line).not.toContain("13.41");
      expect(line).not.toContain("Berlin");
      expect(line).toContain('"event":"weather"');
    }
  });
});

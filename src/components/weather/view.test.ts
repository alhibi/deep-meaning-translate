import { describe, expect, it } from "vitest";
import type { WeatherSnapshot } from "@/lib/weather/types";
import type { WeatherForecastSurface, WeatherSurface } from "./state";
import { resolveWeatherSurface } from "./state";
import { buildReadout, locationMessage, safeAttribution, statusLine } from "./view";
import { COPY } from "./copy";
import { HOUR, MINUTE, makeDays, makeForecast, makeLocation, makeSnapshot } from "./testSupport";

function surfaceOf(
  overrides: Parameters<typeof makeForecast>[0] = {},
  location = makeLocation(),
): WeatherSurface {
  return resolveWeatherSurface({ forecast: makeForecast(overrides), location });
}

function readoutOf(
  overrides: Parameters<typeof makeForecast>[0] = {},
  units: "metric" | "imperial" = "metric",
  locale: "en" | "de" | "ar" = "en",
) {
  const surface = surfaceOf(overrides);
  if (surface.kind !== "forecast") throw new Error(`expected a forecast, got ${surface.kind}`);
  return buildReadout(surface, locale, units);
}

const copy = COPY.en;

describe("weather surface resolution", () => {
  it("renders a fresh snapshot as fresh with its age", () => {
    const surface = surfaceOf();
    expect(surface.kind).toBe("forecast");
    const forecast = surface as WeatherForecastSurface;
    expect(forecast.freshness).toBe("fresh");
    expect(forecast.ageMs).toBe(5 * MINUTE);
    expect(statusLine(forecast, "en")).toBe("Updated 5 min. ago");
  });

  it("never describes an old snapshot as fresh", () => {
    const stale = readoutOf({
      freshness: { ageMs: 20 * MINUTE, isStale: true, isExpired: false },
    });
    expect(stale.statusLine).toBe("Saved 20 min. ago");
    expect(stale.notes).toEqual(["This forecast was saved 20 min. ago and may be out of date."]);

    const expired = readoutOf({
      freshness: { ageMs: 4 * HOUR, isStale: true, isExpired: true },
    });
    expect(expired.statusLine).toBe("Outdated · 4 hr. ago");
    expect(expired.notes[0]).toContain("may have changed");
  });

  it("trusts an explicit stale verdict even when the reported age is small", () => {
    const readout = readoutOf({
      freshness: { ageMs: 2 * MINUTE, isStale: true, isExpired: false },
    });
    expect(readout.statusLine).toBe("Saved 2 min. ago");
    expect(readout.statusLine).not.toContain("Updated");
  });

  it("treats an entry older than the shared fresh window as stale", () => {
    const readout = readoutOf({
      freshness: { ageMs: 20 * MINUTE, isStale: false, isExpired: false },
    });
    expect(readout.freshness).toBe("stale");
    expect(readout.statusLine).toBe("Saved 20 min. ago");
  });

  it("makes no freshness claim when freshness was not supplied", () => {
    const surface = surfaceOf({ freshness: null });
    const forecast = surface as WeatherForecastSurface;
    expect(forecast.freshness).toBe("stale");
    expect(forecast.ageMs).toBeNull();
    expect(buildReadout(forecast, "en", "metric").statusLine).toBe("Saved on this device");
    expect(buildReadout(forecast, "en", "metric").notes).toEqual([
      "This saved forecast may be out of date.",
    ]);
  });

  it("shows an offline snapshot with its age and never as updated", () => {
    const surface = surfaceOf({ offline: true });
    const forecast = surface as WeatherForecastSurface;
    expect(forecast.offline).toBe(true);
    expect(statusLine(forecast, "en")).toBe("Offline · saved 5 min. ago");
    expect(readoutOf({ offline: true }).notes).toEqual([
      "You're offline. Showing the last saved forecast.",
    ]);
  });

  it("keeps the last forecast after a failed update and says so", () => {
    const readout = readoutOf({ status: "error", error: "network" });
    expect(readout.updateFailed).toBe(true);
    expect(readout.statusLine).toBe("Update failed · saved 5 min. ago");
    expect(readout.notes).toEqual(["The update failed. Showing the last saved forecast."]);
  });

  it("marks a snapshot kept while location is off, without hiding it", () => {
    const surface = surfaceOf({}, makeLocation({ status: "denied" }));
    const forecast = surface as WeatherForecastSurface;
    expect(forecast.locationOff).toBe(true);
    expect(statusLine(forecast, "en")).toBe("Location off · saved 5 min. ago");
    expect(buildReadout(forecast, "en", "metric").notes).toEqual([
      "Location is off. Showing the last forecast saved on this device.",
    ]);
  });

  it("offline wins the status line over a failed update and location state", () => {
    const surface = surfaceOf(
      { offline: true, status: "error", error: "network" },
      makeLocation({ status: "revoked" }),
    );
    expect(statusLine(surface as WeatherForecastSurface, "en")).toBe("Offline · saved 5 min. ago");
  });

  it("turns an absent permission into an invitation, not an empty forecast", () => {
    const surface = resolveWeatherSurface({
      forecast: makeForecast({ snapshot: null, status: "idle", freshness: null }),
      location: makeLocation({ status: "prompt" }),
    });
    expect(surface.kind).toBe("permission");
    expect(locationMessage(surface, "en")).toBe("See the weather where you are.");
  });

  it("distinguishes denied from revoked and carries the calm reason", () => {
    const denied = resolveWeatherSurface({
      forecast: makeForecast({ snapshot: null, status: "idle", freshness: null }),
      location: makeLocation({ status: "denied", reason: "permission-denied" }),
    });
    expect(denied.kind).toBe("denied");
    expect(locationMessage(denied, "en")).toBe("Location is off, so the weather can't load.");

    const revoked = resolveWeatherSurface({
      forecast: makeForecast({ snapshot: null, status: "idle", freshness: null }),
      location: makeLocation({ status: "revoked", reason: "user-revoked" }),
    });
    expect(revoked.kind).toBe("denied");
    expect(locationMessage(revoked, "en")).toBe(
      "Location was turned off, so the weather can't load.",
    );
    expect(locationMessage(revoked, "de")).toContain("Standort");
    expect(locationMessage(revoked, "ar")).toContain("الموقع");
  });

  it("explains an unsupported browser and an insecure context calmly", () => {
    const unsupported = resolveWeatherSurface({
      forecast: makeForecast({ snapshot: null, status: "idle", freshness: null }),
      location: makeLocation({ status: "unsupported" }),
    });
    expect(locationMessage(unsupported, "en")).toBe("This browser can't share a location.");

    const insecure = resolveWeatherSurface({
      forecast: makeForecast({ snapshot: null, status: "idle", freshness: null }),
      location: makeLocation({ status: "unsupported", reason: "insecure-context" }),
    });
    expect(locationMessage(insecure, "en")).toBe("Location needs a secure connection.");
  });

  it("asks for a city when permission is fine but the place could not be resolved", () => {
    const surface = resolveWeatherSurface({
      forecast: makeForecast({ snapshot: null, status: "idle", freshness: null }),
      location: makeLocation({ status: "granted", reason: "geocode-failed" }),
    });
    expect(surface.kind).toBe("need-place");
    expect(locationMessage(surface, "en")).toBe(
      "We couldn't find that place. Choose another city.",
    );
  });

  it("stays quiet while locating, and says which step is running", () => {
    const locating = resolveWeatherSurface({
      forecast: makeForecast({ snapshot: null, status: "loading", freshness: null }),
      location: makeLocation({ status: "granted", pending: "locating" }),
    });
    expect(locating.kind).toBe("loading");
    expect(locationMessage(locating, "en")).toBe("Finding your location…");

    // A city search is not a location fix: the forecast wait keeps its own label.
    const searching = resolveWeatherSurface({
      forecast: makeForecast({ snapshot: null, status: "loading", freshness: null }),
      location: makeLocation({ status: "granted", pending: "searching" }),
    });
    expect(locationMessage(searching, "en", "searching")).toBe("Forecast loading");
  });

  it("keeps offline, error and loading apart when there is no snapshot", () => {
    const offline = resolveWeatherSurface({
      forecast: makeForecast({ snapshot: null, status: "ready", freshness: null, offline: true }),
      location: makeLocation(),
    });
    expect(offline.kind).toBe("offline-empty");

    const failed = resolveWeatherSurface({
      forecast: makeForecast({ snapshot: null, status: "error", freshness: null }),
      location: makeLocation(),
    });
    expect(failed.kind).toBe("error");
    expect(locationMessage(failed, "en")).toBe("Weather isn't available right now.");
  });
});

describe("weather readout", () => {
  it("paints place, condition, temperatures, range and precipitation", () => {
    const readout = readoutOf();
    expect(readout.placeName).toBe("Berlin · Deutschland");
    expect(readout.temperature).toBe("12°");
    expect(readout.temperatureWithUnit).toBe("12°C");
    expect(readout.condition).toBe("Partly cloudy");
    expect(readout.range).toBe("4° / 12°");
    expect(readout.precipitation).toBe("40%");
    expect(readout.precipitationAria).toBe("Chance of precipitation 40%");
    expect(readout.details.map((detail) => detail.text)).toEqual([
      "Feels like 10°",
      "Humidity 64%",
      "Wind 14 km/h",
      "Sunrise 7:42 AM",
      "Sunset 4:35 PM",
    ]);
    expect(readout.issuedLine).toBe("Provider updated 11:00 AM");
    expect(readout.attribution).toEqual({
      text: "Weather data by Open-Meteo.com",
      url: "https://open-meteo.com/",
    });
    expect(readout.placeCredit).toBeNull();
  });

  it("renders 24 hourly entries and 7 daily entries from the snapshot", () => {
    const readout = readoutOf();
    expect(readout.hours).toHaveLength(24);
    expect(readout.hours[0]?.clock).toBe("13:00");
    expect(readout.hours[0]?.temperature).toBe("12°");
    // 2026-11-17T12:00Z is 13:00 in Berlin: inside 07:42–16:35, so it is day.
    expect(readout.hours[0]?.isDay).toBe(true);
    // 22:00Z is 23:00 in Berlin: after sunset, so the rail must not draw a sun.
    expect(readout.hours[10]?.isDay).toBe(false);
    expect(readout.days).toHaveLength(7);
    expect(readout.days[0]?.label).toBe("Tue, Nov 17");
    expect(readout.days[0]?.max).toBe("12°");
    expect(readout.days[0]?.min).toBe("4°");
    expect(readout.days[0]?.precipitation).toBe("40%");
    expect(readout.days[1]?.symbol).toBe("rain");
  });

  it("converts displayed values when the unit preference differs from the snapshot", () => {
    const readout = readoutOf({}, "imperial");
    expect(readout.temperature).toBe("54°");
    expect(readout.temperatureWithUnit).toBe("54°F");
    expect(readout.range).toBe("39° / 54°");
    expect(readout.details.map((detail) => detail.text)).toContain("Wind 9 mph");
    expect(readout.hours[0]?.temperature).toBe("54°");
  });

  it("omits sunrise/sunset unless the provider supplied them", () => {
    const days = makeDays().map((day) => {
      const { sunrise, sunset, ...rest } = day;
      void sunrise;
      void sunset;
      return rest;
    });
    const readout = readoutOf({ snapshot: makeSnapshot({ daily: days }) });
    expect(readout.details.join(" ")).not.toContain("Sunrise");
    expect(readout.details.join(" ")).not.toContain("Sunset");
    // Without sunrise/sunset the hourly rail omits its glyph rather than guessing day/night.
    expect(readout.hours[0]?.isDay).toBeNull();
    expect(readout.details.map((detail) => detail.text)).toEqual([
      "Feels like 10°",
      "Humidity 64%",
      "Wind 14 km/h",
    ]);
  });

  it("shows a place-name credit only when the place was resolved by a third party", () => {
    const credited = readoutOf({
      snapshot: makeSnapshot({
        place: {
          ...makeSnapshot().place,
          source: "geolocation",
          placeCredit: "Place name © OpenStreetMap contributors",
        },
      }),
    });
    expect(credited.placeCredit).toBe("Place name © OpenStreetMap contributors");
    // Manual/search places carry no credit by contract.
    expect(readoutOf().placeCredit).toBeNull();
  });

  it("omits optional current details that were not supplied", () => {
    const snapshot = makeSnapshot({
      current: {
        ...makeSnapshot().current,
        apparentTemperature: undefined,
        humidity: undefined,
        windSpeed: undefined,
      },
    });
    const readout = readoutOf({ snapshot });
    expect(readout.details.join(" ")).not.toContain("Feels like");
    expect(readout.details.join(" ")).not.toContain("Humidity");
    expect(readout.details.join(" ")).not.toContain("Wind");
    expect(readout.details).toHaveLength(2);
  });

  it("localizes the readout and its status line", () => {
    const german = readoutOf({}, "metric", "de");
    expect(german.condition).toBe("Teils bewölkt");
    expect(german.statusLine).toBe("Aktualisiert vor 5 Min.");
    expect(german.issuedLine).toBe("Anbieter aktualisiert 11:00");
    const arabic = readoutOf({}, "metric", "ar");
    expect(arabic.condition).toBe("غائم جزئياً");
    expect(arabic.placeName).toBe("Berlin · Deutschland");
    expect(arabic.statusLine).toContain("حُدّث");
  });

  it("does not crash or invent values when optional provider pieces are malformed", () => {
    const readout = readoutOf({
      snapshot: makeSnapshot({
        current: {
          ...makeSnapshot().current,
          symbol: "meteor-shower" as unknown as WeatherSnapshot["current"]["symbol"],
          temperature: Number.NaN,
        },
        issuedAt: "not-a-time",
        attribution: {
          provider: "open-meteo",
          text: "",
          url: "javascript:alert(1)",
        },
      }),
    });
    expect(readout.condition).toBe("Not available");
    expect(readout.temperature).toBe("—");
    expect(readout.temperatureWithUnit).toBe("—");
    expect(readout.issuedLine).toBeNull();
    // Unsafe links are shown as plain text, never as a link URL.
    // Empty attribution text falls back to the provider id; the unsafe URL never survives.
    expect(readout.attribution).toEqual({ text: "open-meteo", url: "" });
  });
});

describe("attribution safety", () => {
  it("rejects non-http(s) attribution URLs", () => {
    expect(
      safeAttribution({ provider: "p", text: "t", url: "data:text/html,<script>" }, copy),
    ).toEqual({ text: "t", url: "" });
    expect(safeAttribution(undefined, copy)).toBeNull();
    expect(safeAttribution({ provider: "p", text: "", url: "https://x.test" }, copy)).toEqual({
      text: "p",
      url: "https://x.test",
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  convertTemperature,
  convertWindSpeed,
  formatClockTime,
  formatDayLabel,
  formatHourClock,
  formatSunTime,
  percentText,
  relativeAge,
  temperatureText,
  temperatureWithUnit,
} from "./format";
import { HOUR, MINUTE } from "./testSupport";

describe("weather formatting", () => {
  it("pins Latin digits in all three interface languages so temperatures align", () => {
    expect(temperatureText(12.4, "metric", "metric", "en")).toBe("12°");
    expect(temperatureText(12.4, "metric", "metric", "de")).toBe("12°");
    expect(temperatureText(12.4, "metric", "metric", "ar")).toBe("12°");
    expect(temperatureWithUnit(12, "metric", "metric", "en")).toBe("12°C");
    expect(temperatureWithUnit(12, "metric", "metric", "de")).toBe("12 °C");
    expect(temperatureWithUnit(12, "metric", "metric", "ar")).toContain("12");
  });

  it("converts between metric and imperial instead of relabelling the number", () => {
    expect(convertTemperature(12, "metric", "imperial")).toBeCloseTo(53.6, 1);
    expect(temperatureText(12, "metric", "imperial", "en")).toBe("54°");
    expect(temperatureText(54, "imperial", "metric", "en")).toBe("12°");
    expect(Math.round(convertWindSpeed(14, "metric", "imperial"))).toBe(9);
    expect(Math.round(convertWindSpeed(9, "imperial", "metric"))).toBe(14);
  });

  it("never paints a negative zero", () => {
    expect(temperatureText(-0.4, "metric", "metric", "en")).toBe("0°");
  });

  it("formats probabilities as localized percentages and clamps bad input", () => {
    expect(percentText(40, "en")).toBe("40%");
    // German puts a no-break space before the percent sign (U+00A0).
    expect(percentText(40, "de")).toBe("40\u00a0%");
    expect(percentText(40, "ar")).toContain("40");
    expect(percentText(150, "en")).toBe("100%");
    expect(percentText(-5, "en")).toBe("0%");
    expect(percentText(Number.NaN, "en")).toBe("—");
  });

  it("describes age with Intl in the interface language", () => {
    expect(relativeAge(0, "en")).toBe("now");
    expect(relativeAge(5 * MINUTE, "en")).toBe("5 min. ago");
    expect(relativeAge(3 * HOUR, "en")).toBe("3 hr. ago");
    expect(relativeAge(49 * HOUR, "en")).toBe("2 days ago");
    expect(relativeAge(5 * MINUTE, "de")).toBe("vor 5 Min.");
    expect(relativeAge(0, "ar")).toBe("الآن");
    expect(relativeAge(Number.NaN, "en")).toBe("now");
  });

  it("formats clock labels in the place's time zone, not the device's", () => {
    expect(formatClockTime("2026-11-17T12:00:00Z", "en", "Europe/Berlin")).toBe("1:00 PM");
    expect(formatClockTime("2026-11-17T10:00:00Z", "de", "Europe/Berlin")).toBe("11:00");
    expect(formatClockTime("2026-11-17T12:00:00Z", "ar", "Europe/Berlin")).toContain("1:00");
    // Forecast rails use one compact 24h shape in every language.
    expect(formatHourClock("2026-11-17T12:00:00Z", "en", "Europe/Berlin")).toBe("13:00");
    expect(formatHourClock("2026-11-17T12:00:00Z", "de", "Europe/Berlin")).toBe("13:00");
    expect(formatHourClock("2026-11-17T12:00:00Z", "ar", "Europe/Berlin")).toBe("13:00");
  });

  it("degrades to no label instead of a wrong time or an Invalid Date", () => {
    expect(formatClockTime("2026-11-17T12:00:00Z", "en", "Not/AZone")).toBe("");
    expect(formatHourClock("2026-11-17T12:00:00Z", "en", "Not/AZone")).toBe("");
    expect(formatHourClock("not-a-date", "en", "Europe/Berlin")).toBe("");
    expect(formatClockTime("not-a-date", "en", "Europe/Berlin")).toBe("");
    expect(formatClockTime("2026-11-17T10:00:00Z", "en", "")).toBe("");
    expect(formatSunTime("07:42", "en", "Europe/Berlin")).toBe("07:42");
    expect(formatSunTime("2026-11-17T06:42:00Z", "en", "Europe/Berlin")).toBe("7:42 AM");
    expect(formatSunTime("sunrise-ish", "en", "Europe/Berlin")).toBe("");
  });

  it("labels days from the local calendar date without a time-zone shift", () => {
    expect(formatDayLabel("2026-11-17", "en")).toBe("Tue, Nov 17");
    expect(formatDayLabel("2026-11-17", "de")).toBe("Di., 17. Nov.");
    expect(formatDayLabel("2026-11-17", "ar")).toContain("نوفمبر");
    expect(formatDayLabel("not-a-date", "en")).toBe("not-a-date");
    expect(formatDayLabel("2026-13-40", "en")).toBe("2026-13-40");
  });
});

import type { Locale } from "@/lib/i18n";
import type {
  WeatherAttribution,
  WeatherDay,
  WeatherHour,
  WeatherSnapshot,
  WeatherSymbol,
  WeatherUnits,
} from "@/lib/weather/types";
import { COPY, fill, type WeatherCopy } from "./copy";
import {
  convertWindSpeed,
  formatClockTime,
  formatDayLabel,
  formatHourClock,
  formatNumber,
  formatSunTime,
  isFiniteNumber,
  parseIso,
  percentText,
  relativeAge,
  roundForDisplay,
  temperatureNumber,
  temperatureText,
  temperatureWithUnit,
} from "./format";
import type {
  WeatherForecastSurface,
  WeatherLocationReason,
  WeatherPending,
  WeatherSurface,
} from "./state";

export interface WeatherHourView {
  key: string;
  /** Clock label, e.g. "13:00" — unambiguous beside a temperature. */
  clock: string;
  temperature: string;
  precipitation: string | null;
  symbol: WeatherSymbol;
  condition: string;
  /** null when the snapshot carries no sunrise/sunset to decide day from night. */
  isDay: boolean | null;
}

export interface WeatherDayView {
  key: string;
  label: string;
  symbol: WeatherSymbol;
  condition: string;
  min: string;
  max: string;
  precipitation: string | null;
}

export interface WeatherDetail {
  key: string;
  text: string;
}

export interface WeatherReadout {
  placeName: string;
  /** Place-name credit (reverse geocoding), only when the provider supplied one. */
  placeCredit: string | null;
  temperature: string;
  temperatureWithUnit: string;
  condition: string;
  symbol: WeatherSymbol;
  isDay: boolean;
  /** Today's min/max; null when the snapshot carries no daily entry. */
  range: string | null;
  /** Today's precipitation probability; null when not supplied. */
  precipitation: string | null;
  precipitationAria: string | null;
  statusLine: string;
  freshness: "fresh" | "stale" | "expired";
  ageMs: number | null;
  offline: boolean;
  locationOff: boolean;
  updateFailed: boolean;
  hours: WeatherHourView[];
  days: WeatherDayView[];
  details: WeatherDetail[];
  issuedLine: string | null;
  notes: string[];
  /** Validated attribution: absent data yields null, never a dead link. */
  attribution: { text: string; url: string } | null;
}

/**
 * Builds everything the expanded surface and the strip paint from one normalized snapshot.
 * Pure: the same snapshot + locale + display units always produce the same strings.
 */
export function buildReadout(
  surface: WeatherForecastSurface,
  locale: Locale,
  displayUnits: WeatherUnits,
): WeatherReadout {
  const copy = COPY[locale];
  const snapshot = surface.snapshot;
  const from = snapshot.units;
  const today = snapshot.daily[0] ?? null;
  const current = snapshot.current;
  const symbol: WeatherSymbol = current.symbol;
  const condition = copy.conditions[symbol] ?? copy.conditions.unknown;
  const temperature = temperatureText(current.temperature, from, displayUnits, locale);
  const attribution = safeAttribution(snapshot.attribution, copy);
  const ageText = surface.ageMs === null ? null : relativeAge(surface.ageMs, locale);

  return {
    placeName: placeName(snapshot, copy),
    placeCredit: snapshot.place.placeCredit?.trim() || null,
    temperature,
    temperatureWithUnit: temperatureWithUnit(current.temperature, from, displayUnits, locale),
    condition,
    symbol,
    isDay: current.isDay !== false,
    range: rangeText(today, snapshot, locale, displayUnits),
    precipitation: precipitationText(today, locale),
    precipitationAria:
      today && isFiniteNumber(today.precipitationProbability)
        ? fill(copy.chanceOfPrecipitation, {
            value: percentText(today.precipitationProbability, locale),
          })
        : null,
    statusLine: statusLine(surface, locale),
    freshness: surface.freshness,
    ageMs: surface.ageMs,
    offline: surface.offline,
    locationOff: surface.locationOff,
    updateFailed: surface.updateFailed,
    hours: hourlyViews(snapshot, today, locale, displayUnits, copy),
    days: dailyViews(snapshot, locale, displayUnits, copy),
    details: detailViews(snapshot, today, locale, displayUnits, copy),
    issuedLine: issuedLine(snapshot, locale, copy),
    notes: noteLines(surface, locale, ageText),
    attribution,
  };
}

export function placeName(snapshot: WeatherSnapshot, copy: WeatherCopy): string {
  return snapshot.place.name?.trim() || copy.yourLocation;
}

function rangeText(
  today: WeatherDay | null,
  snapshot: WeatherSnapshot,
  locale: Locale,
  displayUnits: WeatherUnits,
): string | null {
  if (!today || !isFiniteNumber(today.min) || !isFiniteNumber(today.max)) return null;
  const min = temperatureText(today.min, snapshot.units, displayUnits, locale);
  const max = temperatureText(today.max, snapshot.units, displayUnits, locale);
  return `${min} / ${max}`;
}

function precipitationText(today: WeatherDay | null, locale: Locale): string | null {
  if (!today || !isFiniteNumber(today.precipitationProbability)) return null;
  return percentText(today.precipitationProbability, locale);
}

/**
 * Status line under the place name. Order matters: an offline readout is never described as
 * "updated", a failed update is never hidden behind an age, and an expired cache says so.
 */
export function statusLine(surface: WeatherForecastSurface, locale: Locale): string {
  const copy = COPY[locale];
  const age = surface.ageMs === null ? null : relativeAge(surface.ageMs, locale);
  const withAge = (template: string, noAgeTemplate: string): string =>
    age === null ? noAgeTemplate : fill(template, { age });
  if (surface.offline) return withAge(copy.offlineSaved, copy.offlineSavedNoAge);
  if (surface.updateFailed) return withAge(copy.updateFailedSaved, copy.updateFailedSavedNoAge);
  if (surface.locationOff) return withAge(copy.locationOffSaved, copy.locationOffSavedNoAge);
  if (surface.freshness === "expired") return withAge(copy.outdated, copy.outdatedNoAge);
  if (surface.freshness === "stale") return withAge(copy.saved, copy.savedNoAge);
  return age === null ? copy.savedNoAge : fill(copy.updated, { age });
}

function noteLines(surface: WeatherForecastSurface, locale: Locale, age: string | null): string[] {
  const copy = COPY[locale];
  if (surface.offline) return [copy.offlineNote];
  if (surface.updateFailed) return [copy.updateFailedNote];
  if (surface.locationOff) return [copy.locationOffNote];
  if (surface.freshness === "expired") {
    return [age === null ? copy.staleNoteNoAge : fill(copy.expiredNote, { age })];
  }
  if (surface.freshness === "stale") {
    return [age === null ? copy.staleNoteNoAge : fill(copy.staleNote, { age })];
  }
  return [];
}

function issuedLine(snapshot: WeatherSnapshot, locale: Locale, copy: WeatherCopy): string | null {
  if (!snapshot.issuedAt) return null;
  const time = formatClockTime(snapshot.issuedAt, locale, snapshot.place.timeZone);
  return time ? fill(copy.issued, { time }) : null;
}

function hourlyViews(
  snapshot: WeatherSnapshot,
  today: WeatherDay | null,
  locale: Locale,
  displayUnits: WeatherUnits,
  copy: WeatherCopy,
): WeatherHourView[] {
  const views: WeatherHourView[] = [];
  for (const [index, hour] of snapshot.hourly.slice(0, 24).entries()) {
    const clock = formatHourClock(hour.time, locale, snapshot.place.timeZone);
    if (!clock) continue;
    const symbol: WeatherSymbol = hour.symbol;
    views.push({
      key: `${hour.time}-${index}`,
      clock,
      temperature: temperatureText(hour.temperature, snapshot.units, displayUnits, locale),
      precipitation: isFiniteNumber(hour.precipitationProbability)
        ? percentText(hour.precipitationProbability, locale)
        : null,
      symbol,
      condition: copy.conditions[symbol] ?? copy.conditions.unknown,
      isDay: hourIsDay(hour, today),
    });
  }
  return views;
}

/** Day/night can only be derived from a snapshot that published today's sunrise and sunset. */
function hourIsDay(hour: WeatherHour, today: WeatherDay | null): boolean | null {
  if (!today?.sunrise || !today?.sunset) return null;
  const at = parseIso(hour.time);
  const rise = parseIso(today.sunrise);
  const set = parseIso(today.sunset);
  if (!at || !rise || !set) return null;
  return at.getTime() >= rise.getTime() && at.getTime() < set.getTime();
}

function dailyViews(
  snapshot: WeatherSnapshot,
  locale: Locale,
  displayUnits: WeatherUnits,
  copy: WeatherCopy,
): WeatherDayView[] {
  const views: WeatherDayView[] = [];
  for (const [index, day] of snapshot.daily.slice(0, 7).entries()) {
    const symbol: WeatherSymbol = day.symbol;
    views.push({
      key: `${day.date}-${index}`,
      label: formatDayLabel(day.date, locale),
      symbol,
      condition: copy.conditions[symbol] ?? copy.conditions.unknown,
      min: isFiniteNumber(day.min)
        ? temperatureText(day.min, snapshot.units, displayUnits, locale)
        : "—",
      max: isFiniteNumber(day.max)
        ? temperatureText(day.max, snapshot.units, displayUnits, locale)
        : "—",
      precipitation: isFiniteNumber(day.precipitationProbability)
        ? percentText(day.precipitationProbability, locale)
        : null,
    });
  }
  return views;
}

function detailViews(
  snapshot: WeatherSnapshot,
  today: WeatherDay | null,
  locale: Locale,
  displayUnits: WeatherUnits,
  copy: WeatherCopy,
): WeatherDetail[] {
  const current = snapshot.current;
  const details: WeatherDetail[] = [];
  if (isFiniteNumber(current.apparentTemperature)) {
    details.push({
      key: "feels",
      text: fill(copy.feelsLike, {
        value: temperatureText(current.apparentTemperature, snapshot.units, displayUnits, locale),
      }),
    });
  }
  if (isFiniteNumber(current.humidity)) {
    details.push({
      key: "humidity",
      text: fill(copy.humidity, { value: percentText(current.humidity, locale) }),
    });
  }
  if (isFiniteNumber(current.windSpeed)) {
    const speed = formatNumber(
      locale,
      roundForDisplay(convertWindSpeed(current.windSpeed, snapshot.units, displayUnits)),
    );
    details.push({
      key: "wind",
      text: fill(copy.wind, { value: `${speed} ${copy.windUnit[displayUnits]}` }),
    });
  }
  // Sunrise/sunset are shown only when the provider supplied them (never estimated).
  const sunrise = today?.sunrise
    ? formatSunTime(today.sunrise, locale, snapshot.place.timeZone)
    : "";
  if (sunrise) details.push({ key: "sunrise", text: fill(copy.sunrise, { time: sunrise }) });
  const sunset = today?.sunset ? formatSunTime(today.sunset, locale, snapshot.place.timeZone) : "";
  if (sunset) details.push({ key: "sunset", text: fill(copy.sunset, { time: sunset }) });
  return details;
}

/** Attribution is a licence obligation: render it visibly and never link an unsafe URL. */
export function safeAttribution(
  attribution: WeatherAttribution | undefined,
  copy: WeatherCopy,
): { text: string; url: string } | null {
  if (!attribution) return null;
  const url = attribution.url?.trim() ?? "";
  const text = attribution.text?.trim() || attribution.provider?.trim() || copy.weatherData;
  if (!/^https?:\/\//i.test(url)) return { text, url: "" };
  return { text, url };
}

/** Only the reason keys whose copy is a plain sentence — never a symbol name or unit table. */
type ReasonCopyKey =
  "deniedLine" | "revokedLine" | "insecureLine" | "timeoutLine" | "positionLine" | "geocodeLine";

const REASON_COPY: Partial<Record<WeatherLocationReason, ReasonCopyKey>> = {
  "permission-denied": "deniedLine",
  "user-revoked": "revokedLine",
  "permission-revoked": "revokedLine",
  "insecure-context": "insecureLine",
  timeout: "timeoutLine",
  "position-unavailable": "positionLine",
  "geocode-failed": "geocodeLine",
  "geocode-not-found": "geocodeLine",
};

/** Calm, translated explanation for every location surface; never a status code or reason id. */
export function locationMessage(
  surface: WeatherSurface,
  locale: Locale,
  pending: WeatherPending = "none",
): string {
  const copy = COPY[locale];
  const reasonText = (reason: WeatherLocationReason | null): string | null => {
    if (!reason) return null;
    const key = REASON_COPY[reason];
    return key ? copy[key] : null;
  };
  switch (surface.kind) {
    case "permission":
      return copy.permissionLine;
    case "denied":
      return reasonText(surface.reason) ?? (surface.revoked ? copy.revokedLine : copy.deniedLine);
    case "unsupported":
      return reasonText(surface.reason) ?? copy.unsupportedLine;
    case "need-place":
      return reasonText(surface.reason) ?? copy.geocodeLine;
    case "error":
      return copy.errorLine;
    case "offline-empty":
      return copy.offlineNote;
    case "loading":
      return pending === "locating" || surface.locating ? copy.locating : copy.loading;
    case "forecast":
      return "";
  }
}

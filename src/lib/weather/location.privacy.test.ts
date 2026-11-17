import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const sources = {
  location: read("./location.ts"),
  geocode: read("./geocode.ts"),
  hook: read("./useWeatherLocation.ts"),
} as const;

const entries = Object.entries(sources);

/**
 * Static architecture guards for the privacy invariants that are easy to regress and
 * expensive to get wrong: location must stay out of every content pipeline, the client
 * must not talk to a provider, and no precise or background acquisition may appear.
 */
describe("weather location privacy invariants", () => {
  it("never imports the translation, history, stats or culture pipelines", () => {
    for (const [name, source] of entries) {
      expect(source, name).not.toMatch(
        /@\/lib\/(translation|history|saved|stats|culture|assembly)/,
      );
      expect(source, name).not.toMatch(
        /from\s+["']\.\.\/(translation|history|saved|stats|culture)/,
      );
    }
  });

  it("stores through the validated settings API rather than raw browser storage", () => {
    for (const [name, source] of entries) {
      expect(source, name).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
    expect(sources.location).toMatch(/from "@\/lib\/persistence\/settings"/);
  });

  it("never calls a weather or geocoding provider from the client", () => {
    for (const [name, source] of entries) {
      expect(source, name).not.toMatch(/https?:\/\//);
      expect(source, name).not.toMatch(/open-meteo\.com|nominatim\.openstreetmap\.org/);
      expect(source, name).not.toMatch(/\/v1\/forecast|geocoding-api/);
    }
  });

  it("has no precise, watched or background acquisition", () => {
    for (const [name, source] of entries) {
      expect(source, name).not.toMatch(/watchPosition\(/);
      expect(source, name).not.toMatch(/enableHighAccuracy:\s*true/);
      expect(source, name).not.toMatch(/ACCESS_(FINE|BACKGROUND)_LOCATION/);
      expect(source, name).not.toMatch(/clearWatch\(/);
    }
    expect(sources.location).toMatch(/enableHighAccuracy: false/);
    expect(sources.location).toMatch(/maximumAge: COARSE_MAXIMUM_AGE_MS/);
    expect(sources.location).toMatch(/timeout: COARSE_TIMEOUT_MS/);
  });

  it("only requests a fix inside the explicit consent action", () => {
    expect(sources.hook.match(/currentCoarseFix\(/g)).toHaveLength(1);
    const consent = sources.hook.slice(sources.hook.indexOf("const enableLocation = useCallback"));
    const nextAction = consent.indexOf("const cancel = useCallback");
    expect(consent.slice(0, nextAction)).toMatch(/currentCoarseFix\(/);
    // The mount effect must not contain a location request.
    const mountEffect = sources.hook.slice(
      sources.hook.indexOf("useEffect(() => {\n    disposed.current = false;"),
      sources.hook.indexOf("const enableLocation = useCallback"),
    );
    expect(mountEffect).not.toMatch(/currentCoarseFix\(|getCurrentPosition\(/);
  });

  it("quantizes before the wire and before storage", () => {
    expect(sources.geocode).toMatch(/export const COORDINATE_DECIMALS = 2/);
    expect(sources.geocode).toMatch(/roundCoordinate\(latitude\)\.toFixed\(COORDINATE_DECIMALS\)/);
    expect(sources.hook).toMatch(/coordinatePlace\(/);
    expect(sources.hook).toMatch(/writeStoredPlace\(gpsStoredPlace\(place\)\)/);
    expect(sources.location).toMatch(/LOCATION_PLACE_KEY = "lingua\.weather\.place\.v1"/);
    expect(sources.location).toMatch(
      /LOCATION_REVOKED_KEY = "lingua\.weather\.location\.revoked\.v1"/,
    );
    expect(sources.location).toMatch(/STORED_PLACE_VERSION = 1/);
    // Only the two coarse storage record kinds exist: no fix, no history.
    expect(sources.location).toMatch(/StoredPlaceSource = "gps" \| "manual"/);
  });

  it("keeps the place wire contract in one module", () => {
    expect(sources.geocode).toMatch(/WEB_PLACE_ROUTE = "\/api\/weather\/place"/);
    expect(sources.geocode).toMatch(/NATIVE_PLACE_ROUTE = "\/api\/native\/v1\/weather\/place"/);
    expect(sources.geocode).toMatch(/PLACE_RESULTS_MAX = 8/);
    expect(sources.geocode).toMatch(/PLACE_QUERY_MAX = 80/);
  });

  it("surfaces revocation by clearing, not by keeping the last place", () => {
    expect(sources.hook).toMatch(/clearStoredPlace\(\)/);
    expect(sources.hook).toMatch(/writeLocationRevocation\("user"\)/);
    expect(sources.hook).toMatch(/writeLocationRevocation\("permission"\)/);
    expect(sources.location).toMatch(/revokedState/);
  });
});

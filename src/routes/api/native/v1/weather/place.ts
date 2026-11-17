import { createFileRoute } from "@tanstack/react-router";
import { nativeEndpoint, nativePreflight } from "@/lib/native/gate.server";
import { handleWeatherPlaceRequest } from "@/lib/weather/geocode.server";
import { weatherMethodNotAllowed } from "@/lib/weather/openMeteo.server";

/**
 * Place lookup for the installed Android app: same handler, schema and budget as the web
 * route, authorized by the existing native origin gate (no second same-origin check).
 * Only POST is defined; any other method is an honest 405.
 */
export const Route = createFileRoute("/api/native/v1/weather/place")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      OPTIONS: ({ request }) => nativePreflight(request),
      POST: ({ request }) => nativeEndpoint(request, () => handleWeatherPlaceRequest(request)),
      GET: () => weatherMethodNotAllowed(),
      HEAD: () => weatherMethodNotAllowed(),
      PUT: () => weatherMethodNotAllowed(),
      PATCH: () => weatherMethodNotAllowed(),
      DELETE: () => weatherMethodNotAllowed(),
    },
  },
});

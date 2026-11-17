import { createFileRoute } from "@tanstack/react-router";
import { nativeEndpoint, nativePreflight } from "@/lib/native/gate.server";
import { handleWeatherRequest, weatherMethodNotAllowed } from "@/lib/weather/openMeteo.server";

/**
 * Forecast for the installed Android app. The APK runs from `https://localhost`, so it is
 * authorized by the existing native origin gate instead of the browser same-origin check,
 * and reuses the exact web handler (one schema, one budget, one provider call). Only POST
 * is defined; any other method is an honest 405.
 */
export const Route = createFileRoute("/api/native/v1/weather")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      OPTIONS: ({ request }) => nativePreflight(request),
      POST: ({ request }) => nativeEndpoint(request, () => handleWeatherRequest(request)),
      GET: () => weatherMethodNotAllowed(),
      HEAD: () => weatherMethodNotAllowed(),
      PUT: () => weatherMethodNotAllowed(),
      PATCH: () => weatherMethodNotAllowed(),
      DELETE: () => weatherMethodNotAllowed(),
    },
  },
});

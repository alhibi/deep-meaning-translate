import { createFileRoute } from "@tanstack/react-router";
import { sameOrigin } from "@/lib/requestSafety";
import {
  handleWeatherRequest,
  weatherJson,
  weatherMethodNotAllowed,
} from "@/lib/weather/openMeteo.server";

/**
 * Forecast for the browser. POST, bounded JSON body — a GET would put the (rounded)
 * coordinates into request URLs, logs and caches, so no coordinate ever appears in a URL.
 * The body is { latitude, longitude, units, lang }; the response is a normalized snapshot.
 * Every other method answers 405 instead of falling through to SSR; the route is shared
 * with /api/native/v1/weather, which owns only the origin gate.
 */
export const Route = createFileRoute("/api/weather")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) =>
        sameOrigin(request)
          ? handleWeatherRequest(request)
          : weatherJson({ ok: false, kind: "input" }, 403),
      GET: () => weatherMethodNotAllowed(),
      HEAD: () => weatherMethodNotAllowed(),
      PUT: () => weatherMethodNotAllowed(),
      PATCH: () => weatherMethodNotAllowed(),
      DELETE: () => weatherMethodNotAllowed(),
    },
  },
});

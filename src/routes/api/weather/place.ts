import { createFileRoute } from "@tanstack/react-router";
import { sameOrigin } from "@/lib/requestSafety";
import { handleWeatherPlaceRequest } from "@/lib/weather/geocode.server";
import { weatherJson, weatherMethodNotAllowed } from "@/lib/weather/openMeteo.server";

/**
 * Place lookup for the browser (forward search + consented reverse). POST, bounded JSON,
 * exactly one of { q, lang } or { latitude, longitude, lang }; see geocode.server.ts for
 * the full contract and the Nominatim dependency. Other methods answer 405, never SSR.
 */
export const Route = createFileRoute("/api/weather/place")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) =>
        sameOrigin(request)
          ? handleWeatherPlaceRequest(request)
          : weatherJson({ ok: false, kind: "input" }, 403),
      GET: () => weatherMethodNotAllowed(),
      HEAD: () => weatherMethodNotAllowed(),
      PUT: () => weatherMethodNotAllowed(),
      PATCH: () => weatherMethodNotAllowed(),
      DELETE: () => weatherMethodNotAllowed(),
    },
  },
});

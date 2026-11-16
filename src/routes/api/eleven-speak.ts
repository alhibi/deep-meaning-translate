import { createFileRoute } from "@tanstack/react-router";
import { sameOrigin } from "@/lib/requestSafety";
import { handleElevenSpeak, warmEleven } from "@/lib/voice/speechRoute.server";

/**
 * ElevenLabs timestamped speech, streamed. Shared with `/api/native/v1/eleven-speak`;
 * this route owns only the browser's same-origin rule.
 */
export const Route = createFileRoute("/api/eleven-speak")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      GET: async ({ request }) =>
        sameOrigin(request) ? warmEleven(request) : new Response(null, { status: 204 }),
      POST: async ({ request }) => handleElevenSpeak(request, sameOrigin),
    },
  },
});

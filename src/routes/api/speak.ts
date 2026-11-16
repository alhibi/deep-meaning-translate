import { createFileRoute } from "@tanstack/react-router";
import { sameOrigin } from "@/lib/requestSafety";
import { handleGeminiSpeak, warmGemini } from "@/lib/voice/speechRoute.server";

/**
 * Speaks a translation with Gemini TTS, streamed. The key stays on the server; the text
 * is never logged. Shared with `/api/native/v1/speak`.
 */
export const Route = createFileRoute("/api/speak")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      GET: async ({ request }) =>
        sameOrigin(request) ? warmGemini(request) : new Response(null, { status: 204 }),
      POST: async ({ request }) => handleGeminiSpeak(request, sameOrigin),
    },
  },
});

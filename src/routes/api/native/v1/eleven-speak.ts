import { createFileRoute } from "@tanstack/react-router";
import { nativeEndpoint, nativePreflight } from "@/lib/native/gate.server";
import { handleElevenSpeak, warmEleven } from "@/lib/voice/speechRoute.server";

/** ElevenLabs timestamped speech for the installed app. */
export const Route = createFileRoute("/api/native/v1/eleven-speak")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      OPTIONS: ({ request }) => nativePreflight(request),
      GET: ({ request }) => nativeEndpoint(request, () => warmEleven(request)),
      POST: ({ request }) => nativeEndpoint(request, () => handleElevenSpeak(request, () => true)),
    },
  },
});

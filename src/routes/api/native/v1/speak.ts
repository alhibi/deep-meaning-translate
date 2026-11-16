import { createFileRoute } from "@tanstack/react-router";
import { nativeEndpoint, nativePreflight } from "@/lib/native/gate.server";
import { handleGeminiSpeak, warmGemini } from "@/lib/voice/speechRoute.server";

/** Cloud voice for the installed app; the provider key never reaches the APK. */
export const Route = createFileRoute("/api/native/v1/speak")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      OPTIONS: ({ request }) => nativePreflight(request),
      GET: ({ request }) => nativeEndpoint(request, () => warmGemini(request)),
      POST: ({ request }) => nativeEndpoint(request, () => handleGeminiSpeak(request, () => true)),
    },
  },
});

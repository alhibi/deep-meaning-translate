import { createFileRoute } from "@tanstack/react-router";
import { nativeEndpoint, nativePreflight } from "@/lib/native/gate.server";
import { handleTranslateStream, warmTranslateStream } from "@/lib/translation/streamRoute.server";

/** Live and settled translation for the installed app. Same handler as the web route. */
export const Route = createFileRoute("/api/native/v1/translate-stream")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      OPTIONS: ({ request }) => nativePreflight(request),
      GET: ({ request }) => nativeEndpoint(request, () => warmTranslateStream(request)),
      POST: ({ request }) => nativeEndpoint(request, () => handleTranslateStream(request)),
    },
  },
});

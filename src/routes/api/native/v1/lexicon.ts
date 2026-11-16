import { createFileRoute } from "@tanstack/react-router";
import { nativeEndpoint, nativePreflight } from "@/lib/native/gate.server";
import { nativeLexicon } from "@/lib/native/handlers.server";

/** Dictionary lookup for the installed app. */
export const Route = createFileRoute("/api/native/v1/lexicon")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      OPTIONS: ({ request }) => nativePreflight(request),
      POST: ({ request }) => nativeEndpoint(request, () => nativeLexicon(request)),
    },
  },
});

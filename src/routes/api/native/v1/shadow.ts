import { createFileRoute } from "@tanstack/react-router";
import { nativeEndpoint, nativePreflight } from "@/lib/native/gate.server";
import { nativeShadow } from "@/lib/native/handlers.server";

/** Sentence shadow analysis for the installed app. */
export const Route = createFileRoute("/api/native/v1/shadow")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      OPTIONS: ({ request }) => nativePreflight(request),
      POST: ({ request }) => nativeEndpoint(request, () => nativeShadow(request)),
    },
  },
});

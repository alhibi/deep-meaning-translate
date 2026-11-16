import { createFileRoute } from "@tanstack/react-router";
import { nativeEndpoint, nativePreflight } from "@/lib/native/gate.server";
import { nativeDictation } from "@/lib/native/handlers.server";

/** Short-lived AssemblyAI token for dictation; the permanent key stays on the server. */
export const Route = createFileRoute("/api/native/v1/dictation-token")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      OPTIONS: ({ request }) => nativePreflight(request),
      POST: ({ request }) => nativeEndpoint(request, () => nativeDictation(request)),
    },
  },
});

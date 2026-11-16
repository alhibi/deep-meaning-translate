import { createFileRoute } from "@tanstack/react-router";
import { nativeEndpoint, nativePreflight } from "@/lib/native/gate.server";
import { nativeRepair } from "@/lib/native/handlers.server";

/** Quiet second pass for a settled translation. */
export const Route = createFileRoute("/api/native/v1/repair")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      OPTIONS: ({ request }) => nativePreflight(request),
      POST: ({ request }) => nativeEndpoint(request, () => nativeRepair(request)),
    },
  },
});

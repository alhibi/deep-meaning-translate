import { createFileRoute } from "@tanstack/react-router";
import { handleTranslateStream, warmTranslateStream } from "@/lib/translation/streamRoute.server";
import { sameOrigin } from "@/lib/requestSafety";

/**
 * Live translation while typing: plain-text stream so words appear as they are generated.
 * The handler itself is shared with `/api/native/v1/translate-stream`; this route only
 * owns the browser's same-origin rule.
 */
export const Route = createFileRoute("/api/translate-stream")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      GET: async ({ request }) => {
        const noContent = new Response(null, {
          status: 204,
          headers: { "Cache-Control": "no-store" },
        });
        if (!sameOrigin(request)) return noContent;
        return warmTranslateStream(request);
      },
      POST: async ({ request }) => {
        if (!sameOrigin(request))
          return Response.json(
            { ok: false, kind: "input" },
            { status: 403, headers: { "Cache-Control": "no-store" } },
          );
        return handleTranslateStream(request);
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { ElevenInput, elevenBody } from "@/lib/voice/elevenVoice";
import { kindForStatus } from "@/lib/voice/geminiVoice";
import { boundedJson, sameOrigin } from "@/lib/requestSafety";

export const Route = createFileRoute("/api/eleven-speak")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => {
        const fail = (kind: string, status: number, retry?: string | null) =>
          Response.json(
            { ok: false, kind, status },
            {
              status,
              headers: { "Cache-Control": "no-store", ...(retry ? { "Retry-After": retry } : {}) },
            },
          );
        // The app has no user accounts. This same-origin endpoint is intentionally public,
        // like translation/Gemini; Origin checks prevent cross-site browser spending, not bots.
        if (!sameOrigin(request)) return fail("input", 403);
        let data;
        try {
          data = ElevenInput.parse(await boundedJson(request));
        } catch {
          return fail("input", 400);
        }
        const key = process.env["ELEVENLABS_API_KEY"];
        if (!key) return fail("config", 503);
        const ctrl = new AbortController();
        const abort = () => ctrl.abort();
        request.signal.addEventListener("abort", abort, { once: true });
        if (request.signal.aborted) ctrl.abort();
        const timer = setTimeout(abort, 45000);
        const cleanup = () => {
          clearTimeout(timer);
          request.signal.removeEventListener("abort", abort);
        };
        try {
          const res = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${data.voice}/stream/with-timestamps?output_format=pcm_24000`,
            {
              method: "POST",
              headers: { "xi-api-key": key, "Content-Type": "application/json" },
              body: JSON.stringify(elevenBody(data)),
              signal: ctrl.signal,
            },
          );
          if (!res.ok || !res.body) {
            cleanup();
            // Never log provider bodies: they can contain the private input text.
            await res.body?.cancel();
            console.warn("[eleven-speak] provider status", res.status);
            return fail(kindForStatus(res.status), res.status, res.headers.get("Retry-After"));
          }
          const reader = res.body.getReader();
          return new Response(
            new ReadableStream<Uint8Array>({
              async pull(c) {
                try {
                  const { value, done } = await reader.read();
                  if (done) {
                    cleanup();
                    c.close();
                  } else c.enqueue(value);
                } catch {
                  cleanup();
                  if (request.signal.aborted) c.close();
                  else c.error(new Error("network"));
                }
              },
              cancel() {
                cleanup();
                ctrl.abort();
                void reader.cancel().catch(() => {});
              },
            }),
            {
              headers: {
                "Content-Type": "application/x-ndjson",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
              },
            },
          );
        } catch {
          cleanup();
          if (request.signal.aborted) return new Response(null, { status: 204 });
          return fail(ctrl.signal.aborted ? "timeout" : "network", ctrl.signal.aborted ? 504 : 502);
        }
      },
    },
  },
});

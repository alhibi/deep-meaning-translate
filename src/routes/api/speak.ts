import { createFileRoute } from "@tanstack/react-router";
import { boundedJson, clientAddress, sameOrigin } from "@/lib/requestSafety";
import { createLimiter } from "@/lib/translation/throttle";
import {
  SpeakInput,
  buildInteraction,
  createSseAudioParser,
  kindForStatus,
} from "@/lib/voice/geminiVoice";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** Until when the main TTS model's quota is known to be exhausted (per server instance). */
let bestExhaustedUntil = 0;

/** Coarse in-process throttle for speech, separate from translation. */
const takeSpeechToken = createLimiter(40, 1.5);

/**
 * Speaks a translation with Gemini TTS, streamed: raw 16-bit 24 kHz mono PCM is forwarded
 * the moment Google produces it, so playback starts long before synthesis ends.
 * The key stays on the server; the text is never logged.
 */
export const Route = createFileRoute("/api/speak")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      // Warm-up: open DNS/TLS to Google before the first Listen tap. No key, no text.
      GET: async () => {
        await fetch(ENDPOINT, { method: "HEAD" }).catch(() => {});
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      },
      POST: async ({ request }) => {
        const fail = (kind: string, status: number, extra?: Record<string, string>) =>
          Response.json(
            { ok: false, kind },
            { status, headers: { "Cache-Control": "no-store", ...extra } },
          );
        if (!sameOrigin(request)) return fail("input", 403);
        if (!takeSpeechToken(clientAddress(request))) return fail("rate", 429, { "Retry-After": "5" });
        let data;
        try {
          data = SpeakInput.parse(await boundedJson(request));
        } catch {
          return fail("input", 400);
        }
        const key = process.env["GEMINI_API_KEY"];
        if (!key) return fail("config", 503);

        const ctrl = new AbortController();
        const onAbort = () => ctrl.abort();
        request.signal.addEventListener("abort", onAbort);
        if (request.signal.aborted) onAbort();
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          ctrl.abort();
        }, 45_000);
        const cleanup = () => {
          clearTimeout(timer);
          request.signal.removeEventListener("abort", onAbort);
        };
        const call = (quality: "best" | "fast") =>
          fetch(ENDPOINT, {
            method: "POST",
            headers: {
              "x-goog-api-key": key,
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify(buildInteraction({ ...data, quality }, true)),
            signal: ctrl.signal,
          });
        let res: Response;
        try {
          // The main model's daily limit is used up: go straight to the light model.
          const quality =
            data.quality === "best" && Date.now() < bestExhaustedUntil ? "fast" : data.quality;
          res = await call(quality);
          if (res.status === 429 && quality === "best") {
            const retry = Number(res.headers.get("Retry-After")) || 3600;
            bestExhaustedUntil = Date.now() + retry * 1000;
            console.warn("[speak] main voice model limit reached; using the light model");
            await res.body?.cancel();
            res = await call("fast");
          }
        } catch {
          cleanup();
          if (request.signal.aborted) return new Response(null, { status: 204 });
          return fail(timedOut ? "timeout" : "network", timedOut ? 504 : 502);
        }
        if (!res.ok || !res.body) {
          await res.body?.cancel();
          cleanup();
          const kind = kindForStatus(res.status);
          console.warn("[speak] gemini status", res.status, data.quality);
          const retry = res.headers.get("Retry-After");
          return fail(
            kind,
            kind === "quota" ? 429 : kind === "input" ? 400 : 502,
            retry ? { "Retry-After": retry } : undefined,
          );
        }

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        const parse = createSseAudioParser();
        let completed = false;
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              for (;;) {
                const { value, done } = await reader.read();
                if (done) {
                  const final = parse(dec.decode() + "\n");
                  completed ||= !!final.done;
                  if (final.error || !completed) throw new Error("provider");
                  for (const a of final.audio) controller.enqueue(a);
                  cleanup();
                  controller.close();
                  return;
                }
                const out = parse(dec.decode(value, { stream: true }));
                completed ||= !!out.done;
                if (out.error) {
                  throw new Error("provider");
                }
                if (out.audio.length) {
                  for (const a of out.audio) controller.enqueue(a);
                  return;
                }
              }
            } catch {
              ctrl.abort();
              void reader.cancel().catch(() => {});
              cleanup();
              // Cancelled by the app: end quietly.
              if (request.signal.aborted) controller.close();
              else controller.error(new Error("network"));
            }
          },
          cancel() {
            cleanup();
            ctrl.abort();
            void reader.cancel().catch(() => {});
          },
        });
        return new Response(body, {
          headers: {
            "Content-Type": "audio/l16; rate=24000; channels=1",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});

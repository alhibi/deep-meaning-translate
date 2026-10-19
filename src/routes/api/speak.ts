import { createFileRoute } from "@tanstack/react-router";
import {
  SpeakInput,
  base64ToBytes,
  buildInteraction,
  extractAudio,
  kindForStatus,
  normalizeToWav,
} from "@/lib/voice/geminiVoice";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** Coarse in-process throttle for speech, separate from translation. */
const bucket = { tokens: 12, updated: Date.now() };
function takeSpeechToken() {
  const now = Date.now();
  bucket.tokens = Math.min(12, bucket.tokens + ((now - bucket.updated) / 1000) * 0.3);
  bucket.updated = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/**
 * Speaks a translation with Gemini TTS. The key stays on the server; the browser only
 * receives WAV audio. The text is never logged.
 */
export const Route = createFileRoute("/api/speak")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => {
        const fail = (kind: string, status: number, extra?: Record<string, string>) =>
          Response.json(
            { ok: false, kind },
            { status, headers: { "Cache-Control": "no-store", ...extra } },
          );
        let data;
        try {
          data = SpeakInput.parse(await request.json());
        } catch {
          return fail("input", 400);
        }
        if (!takeSpeechToken()) return fail("rate", 429, { "Retry-After": "5" });
        const key = process.env["GEMINI_API_KEY"];
        if (!key) return fail("config", 503);

        const ctrl = new AbortController();
        const onAbort = () => ctrl.abort();
        request.signal.addEventListener("abort", onAbort);
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          ctrl.abort();
        }, 45_000);
        try {
          const res = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
            body: JSON.stringify(buildInteraction(data)),
            signal: ctrl.signal,
          });
          if (!res.ok) {
            const kind = kindForStatus(res.status);
            console.warn("[speak] gemini status", res.status, data.quality);
            const retry = res.headers.get("Retry-After");
            return fail(
              kind,
              kind === "quota" ? 429 : kind === "input" ? 400 : 502,
              retry ? { "Retry-After": retry } : undefined,
            );
          }
          const audio = extractAudio(await res.json());
          if (!audio) return fail("provider", 502);
          const wav = normalizeToWav(base64ToBytes(audio.data), audio.mime);
          if (!wav) {
            console.warn("[speak] unexpected audio format", audio.mime);
            return fail("provider", 502);
          }
          return new Response(wav, {
            headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
          });
        } catch {
          if (request.signal.aborted) return new Response(null, { status: 204 });
          return fail(timedOut ? "timeout" : "network", timedOut ? 504 : 502);
        } finally {
          clearTimeout(timer);
          request.signal.removeEventListener("abort", onAbort);
        }
      },
    },
  },
});

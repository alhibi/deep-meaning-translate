/**
 * Gemini and ElevenLabs speech, shared by the browser routes and the versioned native
 * routes. Keys are read here only; the text is never logged. Each caller supplies its
 * own authorization rule (same-origin for the web, the app's origin allowlist for the APK).
 */
import { SpeakInput, buildInteraction, createSseAudioParser, kindForStatus } from "./geminiVoice";
import { ElevenInput, elevenBody } from "./elevenVoice";
import { clientAddress, parseAdmittedJson } from "../requestSafety";
import { takeSpeechToken, takeWarmToken } from "../translation/throttle";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const ELEVEN_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";

/** Until when the main TTS model's quota is known to be exhausted (per server instance). */
let bestExhaustedUntil = 0;

export type Authorize = (request: Request) => boolean;

const noContent = () =>
  new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
const forbidden = () =>
  Response.json(
    { ok: false, kind: "input" },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );

/** Open DNS/TLS to the speech provider before the first Listen tap. No key, no text. */
export async function warmGemini(request: Request): Promise<Response> {
  if (!takeWarmToken(clientAddress(request))) return noContent();
  await fetch(GEMINI_ENDPOINT, { method: "HEAD" }).catch(() => {});
  return noContent();
}

export async function warmEleven(request: Request): Promise<Response> {
  if (!takeWarmToken(clientAddress(request))) return noContent();
  await fetch("https://api.elevenlabs.io/v1/models", { method: "HEAD" }).catch(() => {});
  return noContent();
}

/**
 * Speaks a translation with Gemini TTS, streamed: raw 16-bit 24 kHz mono PCM is forwarded
 * the moment Google produces it, so playback starts long before synthesis ends.
 */
export async function handleGeminiSpeak(request: Request, authorize: Authorize): Promise<Response> {
  const fail = (kind: string, status: number, extra?: Record<string, string>) =>
    Response.json(
      { ok: false, kind },
      { status, headers: { "Cache-Control": "no-store", ...extra } },
    );
  if (!authorize(request)) return forbidden();
  const admitted = await parseAdmittedJson(request, SpeakInput, () =>
    takeSpeechToken(clientAddress(request)),
  );
  if (!admitted.ok)
    return admitted.kind === "rate"
      ? fail("rate", 429, { "Retry-After": "5" })
      : fail("input", 400);
  const data = admitted.data;
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
    fetch(GEMINI_ENDPOINT, {
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
}

/** ElevenLabs timestamped audio, forwarded as the provider emits it. */
export async function handleElevenSpeak(request: Request, authorize: Authorize): Promise<Response> {
  const fail = (kind: string, status: number, retry?: string | null) =>
    Response.json(
      { ok: false, kind, status },
      {
        status,
        headers: { "Cache-Control": "no-store", ...(retry ? { "Retry-After": retry } : {}) },
      },
    );
  if (!authorize(request)) return forbidden();
  // Speech synthesis is the most expensive call in the app: it needs its own budget.
  const admitted = await parseAdmittedJson(request, ElevenInput, () =>
    takeSpeechToken(clientAddress(request)),
  );
  if (!admitted.ok) return admitted.kind === "rate" ? fail("rate", 429, "5") : fail("input", 400);
  const data = admitted.data;
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
      `${ELEVEN_ENDPOINT}/${data.voice}/stream/with-timestamps?output_format=pcm_24000`,
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
}

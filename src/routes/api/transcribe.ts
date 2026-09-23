import { createFileRoute } from "@tanstack/react-router";

const MODEL = "google/gemini-3.5-transcribe";
const MAX_FILE = 13 * 1024 * 1024; // Gemini caps audio at 14 MB; keep headroom
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

export const Route = createFileRoute("/api/transcribe")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return Response.json({ error: "not_configured" }, { status: 500 });
        const declared = Number(request.headers.get("content-length") ?? 0);
        if (declared > MAX_FILE + 64 * 1024) return Response.json({ error: "too_large" }, { status: 413 });

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return Response.json({ error: "bad_request" }, { status: 400 });
        }
        const file = form.get("file");
        if (!(file instanceof File) || file.size < 2048 || file.size > MAX_FILE || !file.type.startsWith("audio/")) {
          return Response.json({ error: "bad_audio" }, { status: 400 });
        }
        const lang = String(form.get("language") ?? "");

        const up = new FormData();
        up.append("model", MODEL);
        up.append("file", file, file.name || "speech.wav");
        up.append("response_format", "json");
        up.append("stream", "true");
        if (LANG.test(lang)) up.append("language", lang);

        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
            method: "POST",
            headers: { "Lovable-API-Key": key },
            body: up,
            signal: request.signal,
          });
          return new Response(res.body, {
            status: res.status,
            headers: { "content-type": res.headers.get("content-type") ?? "text/event-stream", "cache-control": "no-store" },
          });
        } catch (e) {
          if ((e as Error)?.name === "AbortError") return new Response(null, { status: 499 });
          return Response.json({ error: "upstream" }, { status: 502 });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { InputSchema } from "@/lib/translation/translate.functions";
import { takeToken } from "@/lib/translation/throttle";
import { z } from "zod";

const StreamInput = InputSchema.extend({
  mode: z.enum(["live", "full"]).optional().default("live"),
});

/** Live translation while typing: plain-text stream so words appear as they are generated. */
export const Route = createFileRoute("/api/translate-stream")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      // Warm-up: resolve and open the connection to the provider so the first real
      // translation skips DNS/TLS setup. Sends no text and no credentials.
      GET: async () => {
        // Both brains, in parallel: whichever writes (or falls back) is already connected.
        await Promise.all([
          fetch("https://opencode.ai/zen/go/v1/models", { method: "HEAD" }).catch(() => {}),
          fetch("https://api.deepseek.com/models", { method: "HEAD" }).catch(() => {}),
        ]);
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      },
      POST: async ({ request }) => {
        const fail = (kind: string, status: number) =>
          Response.json({ ok: false, kind }, { status });
        let data;
        try {
          data = StreamInput.parse(await request.json());
        } catch {
          return fail("input", 400);
        }
        if (!takeToken()) return fail("rate", 429);
        const apiKey = process.env["OPENCODE_API_KEY"];

        const { streamLiveTranslation, streamFullTranslation } =
          await import("@/lib/translation/providers/opencode.server");
        const { TranslationError } = await import("@/lib/translation/types");
        const started = Date.now();
        let deltas: AsyncGenerator<string>;
        const { mode, ...rest } = data;
        const req = { ...rest, partial: mode !== "full" };
        const ds = await import("@/lib/translation/providers/deepseek.server");
        const { shouldFallBack } = await import("@/lib/translation/engine.server");
        const brains = {
          luna: () => {
            if (!apiKey) throw new TranslationError("auth", "Luna is not configured.");
            return mode === "full"
              ? streamFullTranslation(apiKey, req, request.signal)
              : streamLiveTranslation(apiKey, req, request.signal);
          },
          deepseek: () => {
            const key = ds.deepseekKey();
            if (!key) throw new TranslationError("auth", "DeepSeek is not configured.");
            return mode === "full"
              ? ds.streamDeepSeekFull(key, req, request.signal)
              : ds.streamDeepSeekLive(key, req, request.signal);
          },
        } as const;
        let brain: keyof typeof brains = data.brain;
        try {
          try {
            deltas = await brains[brain]();
          } catch (err) {
            // The other brain takes over when the chosen one is down, out of credit or rate limited.
            if (request.signal.aborted || !shouldFallBack(err)) throw err;
            brain = brain === "luna" ? "deepseek" : "luna";
            deltas = await brains[brain]();
          }
        } catch (err) {
          // Cancelled by the app (newer text typed): end quietly, not an error.
          if (request.signal.aborted || (err as Error)?.name === "AbortError")
            return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
          const kind = err instanceof TranslationError ? err.kind : "provider";
          return fail(kind, kind === "rate" ? 429 : 502);
        }

        const enc = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            let outcome = "ok";
            try {
              for await (const d of deltas) controller.enqueue(enc.encode(d));
              controller.close();
            } catch (err) {
              // The app cancels outdated translations on purpose; a dropped
              // connection is normal, not a server error — end quietly.
              const cancelled =
                request.signal.aborted ||
                (err as Error)?.name === "AbortError" ||
                (err as Error)?.message === "aborted";
              outcome = cancelled ? "cancelled" : "stream_error";
              if (cancelled) {
                try {
                  controller.close();
                } catch {
                  /* already closed */
                }
              } else controller.error(err);
            } finally {
              // Privacy: metrics only — never the text.
              console.info(
                JSON.stringify({
                  event: "translate_stream",
                  mode: data.mode,
                  brain,
                  outcome,
                  ms: Date.now() - started,
                  chars: data.text.length,
                }),
              );
            }
          },
          cancel() {
            void deltas.return(undefined).catch(() => {});
          },
        });
        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store, no-transform",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});

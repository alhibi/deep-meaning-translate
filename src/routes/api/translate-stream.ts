import { createFileRoute } from "@tanstack/react-router";
import { InputSchema } from "@/lib/translation/translate.functions";
import { takeToken } from "@/lib/translation/throttle";

/** Live translation while typing: plain-text stream so words appear as they are generated. */
export const Route = createFileRoute("/api/translate-stream")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      // Warm-up: resolve and open the connection to the provider so the first real
      // translation skips DNS/TLS setup. Sends no text and no credentials.
      GET: async () => {
        await fetch("https://opencode.ai/zen/go/v1/models", { method: "HEAD" }).catch(() => {});
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      },
      POST: async ({ request }) => {
        const fail = (kind: string, status: number) =>
          Response.json({ ok: false, kind }, { status });
        let data;
        try {
          data = InputSchema.parse(await request.json());
        } catch {
          return fail("input", 400);
        }
        if (!takeToken()) return fail("rate", 429);
        const apiKey = process.env["OPENCODE_API_KEY"];
        if (!apiKey) return fail("auth", 500);

        const { streamLiveTranslation } =
          await import("@/lib/translation/providers/opencode.server");
        const { TranslationError } = await import("@/lib/translation/types");
        const started = Date.now();
        let deltas: AsyncGenerator<string>;
        try {
          deltas = await streamLiveTranslation(apiKey, { ...data, partial: true }, request.signal);
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return new Response(null, { status: 499 });
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
              outcome = (err as Error)?.name === "AbortError" ? "cancelled" : "stream_error";
              controller.error(err);
            } finally {
              // Privacy: metrics only — never the text.
              console.info(
                JSON.stringify({
                  event: "translate_stream",
                  outcome,
                  ms: Date.now() - started,
                  chars: data.text.length,
                }),
              );
            }
          },
          cancel() {
            void deltas.return(undefined);
          },
        });
        return new Response(body, {
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      },
    },
  },
});

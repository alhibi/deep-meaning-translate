/** Direct-provider safety net covers both response headers and body consumption. */
export async function providerFetch(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
  const timer = setTimeout(abort, 60_000);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (error) {
    cleanup();
    throw error;
  }
  if (!response.body) { cleanup(); return response; }
  const reader = response.body.getReader();
  const cancelReader = () => { void reader.cancel().catch(() => {}); };
  ctrl.signal.addEventListener("abort", cancelReader, { once: true });
  const finish = () => { cleanup(); ctrl.signal.removeEventListener("abort", cancelReader); };
  if (ctrl.signal.aborted) cancelReader();
  return new Response(new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const { value, done } = await reader.read();
        if (ctrl.signal.aborted) throw new DOMException("Cancelled", "AbortError");
        if (done) { finish(); c.close(); } else c.enqueue(value);
      } catch (error) { finish(); ctrl.abort(); c.error(error); }
    },
    cancel() { ctrl.abort(); finish(); return reader.cancel().catch(() => {}); },
  }), { status: response.status, statusText: response.statusText, headers: response.headers });
}
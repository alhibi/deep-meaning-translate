import type { ErrorKind } from "./useTranslator";
import type { Brain } from "./types";
import { partialTranslation } from "./parse";
import { isNativeApp, nativeApiUrl } from "../native/config";
import { hasProviderKey } from "./providerKey";
import { streamDirect } from "./direct";
import {
  beginTransport,
  classifyFetchError,
  classifyStatus,
  safeDiagnosticMessage,
  type DiagnosticKind,
} from "../native/diagnostics";

/** The app's UI is served from the APK, so its calls need the real server's address. */
const streamUrl = () =>
  isNativeApp() ? nativeApiUrl("/api/native/v1/translate-stream") : "/api/translate-stream";

export type StreamResponse =
  | { ok: true; text: string; /** Actual writer, after any provider fallback. */ writer?: Brain }
  | { ok: false; kind: ErrorKind; cancelled?: true };

function errorKindFor(kind: DiagnosticKind, status?: number): ErrorKind {
  if (status === 401) return "auth";
  if (status === 429) return "rate";
  if (kind === "offline") return "offline";
  if (kind === "timeout") return "timeout";
  if (kind === "network" || kind === "network-or-cors" || kind === "cors" || kind === "dns")
    return "network";
  if (kind === "tls" || kind === "stream") return "network";
  if (kind === "auth") return "auth";
  if (kind === "quota") return "quota";
  if (kind === "rate") return "rate";
  if (kind === "input") return "input";
  return "provider";
}

/** Client side of the live stream: calls onText with the accumulated translation as it grows. */
export async function streamTranslate(
  data: Record<string, unknown>,
  signal: AbortSignal,
  onText: (text: string) => void,
  mode: "live" | "full" = "live",
): Promise<StreamResponse> {
  // Personal-key mode: call DeepSeek from this device, bypassing the deployed service and
  // its shared admission budget. A network/provider failure falls back to the service, so
  // a key never makes the app less available than it was without one. Luna is a
  // server-side brain: a Luna request must stay on the service rather than be silently
  // written by DeepSeek with the device key.
  if (isNativeApp() && hasProviderKey() && data["brain"] !== "luna") {
    const direct = await streamDirect(data, signal, onText, mode);
    // The device path is DeepSeek by construction.
    if (direct.ok) return { ...direct, writer: "deepseek" };
    if (direct.cancelled) return direct;
    if (direct.kind !== "network" && direct.kind !== "timeout" && direct.kind !== "provider")
      return direct;
  }
  const url = streamUrl();
  if (!url) return { ok: false, kind: "network" };
  const diagnostics = beginTransport({ transport: "webview-fetch", method: "POST", url });
  let chunks = 0;
  let bytes = 0;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, mode }),
      signal,
      credentials: "omit",
      cache: "no-store",
    });
    diagnostics.finish({
      stage: "response",
      status: res.status,
      contentType: res.headers.get("content-type") ?? undefined,
    });
    // A 204 is a quiet cancellation, not a provider failure and has no body.
    if (res.status === 204) {
      diagnostics.finish({ stage: "done", kind: "abort", cancelled: true });
      return { ok: false, kind: "provider", cancelled: true };
    }
    if (!res.ok || !res.body) {
      // The small JSON error body is the server's classification (auth, quota, rate,
      // provider). Read it first: cancelling the body and then calling res.json() made
      // every non-429 failure look like a generic provider error and triggered a pointless
      // salvage stream on a strictly selected, unavailable model.
      const payload = (await res.json().catch(() => null)) as { kind?: ErrorKind } | null;
      const detail = classifyStatus(res.status);
      diagnostics.finish({
        stage: "error",
        kind: detail,
        errorMessage: payload?.kind ? `kind=${payload.kind}` : undefined,
      });
      return { ok: false, kind: payload?.kind ?? errorKindFor(detail, res.status) };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = "";
    // An abort must also unblock a body that never sends another chunk: a browser fetch
    // errors the body on abort, but a mocked/WebView transport can leave reader.read()
    // pending forever, which kept a dead request alive until the connection died.
    const stopReading = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", stopReading, { once: true });
    try {
      if (signal.aborted) stopReading();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks += 1;
        bytes += value.byteLength;
        text += dec.decode(value, { stream: true });
        const visible = mode === "full" ? partialTranslation(text) : text;
        if (visible.trim()) onText(visible.trim());
      }
      text = (text + dec.decode()).trim();
    } finally {
      signal.removeEventListener("abort", stopReading);
    }
    // reader.cancel() ends the loop quietly; the caller's abort is still a cancellation,
    // never a complete answer and never a retryable provider failure.
    if (signal.aborted) {
      diagnostics.finish({ stage: "error", kind: "abort", chunks, bytes, cancelled: true });
      return { ok: false, kind: "provider", cancelled: true };
    }
    diagnostics.finish({
      stage: "done",
      chunks,
      bytes,
      ...(text ? {} : { kind: "empty" as const }),
    });
    if (!text) return { ok: false, kind: "provider" };
    const header = res.headers.get("x-translation-writer");
    const writer: Brain | undefined =
      header === "luna" || header === "deepseek" ? header : undefined;
    return { ok: true, text, ...(writer ? { writer } : {}) };
  } catch (error) {
    const name = (error as Error)?.name;
    const cancelled = signal.aborted;
    const kind = classifyFetchError(error);
    diagnostics.finish({
      stage: "error",
      kind,
      ...(cancelled ? { cancelled: true } : {}),
      ...(name ? { errorName: name } : {}),
      ...(safeDiagnosticMessage((error as Error)?.message)
        ? { errorMessage: safeDiagnosticMessage((error as Error)?.message) }
        : {}),
    });
    // The caller's own AbortSignal went off: the request was superseded, the screen was
    // left or the watchdog fired. That is a quiet end, never a provider failure that a
    // caller could retry — only the caller's signal knows, not the error's shape.
    if (cancelled) return { ok: false, kind: "provider", cancelled: true };
    return { ok: false, kind: errorKindFor(kind) };
  }
}

/** Fire-and-forget: opens the connection chain to the translation service before the first request. */
export function warmTranslation(): void {
  if (typeof fetch === "undefined") return;
  // Direct mode has no Worker connection to warm and must not spend a provider call here.
  if (isNativeApp() && hasProviderKey()) return;
  const url = streamUrl();
  if (!url) return;
  void fetch(url, { method: "GET", cache: "no-store", credentials: "omit" }).catch(() => {});
}

import { isNativeApp } from "./config";

/**
 * Safe, bounded transport diagnostics.
 *
 * The app deliberately records no sentence, prompt, body, header or key here: only the
 * shape of the request and the failure. A request id joins the record to the screen, so a
 * person can copy a report without handing over what they translated.
 */
export type TransportName = "webview-fetch" | "capacitor-http" | "server-json" | "deepseek-direct";

export type DiagnosticStage = "request" | "response" | "stream" | "parse" | "done" | "error";

export type DiagnosticKind =
  | "network"
  | "network-or-cors"
  | "offline"
  | "timeout"
  | "abort"
  | "cors"
  | "dns"
  | "tls"
  | "http-403"
  | "http-404"
  | "http-401"
  | "http-429"
  | "http-5xx"
  | "http-other"
  | "empty"
  | "malformed"
  | "stream"
  | "provider"
  | "auth"
  | "quota"
  | "rate"
  | "input"
  | "unknown";

export interface TransportRecord {
  id: string;
  at: number;
  platform: "native" | "web";
  transport: TransportName;
  method: string;
  /** Origin + path only: no query string, body or token. */
  url: string;
  status?: number;
  contentType?: string;
  kind?: DiagnosticKind;
  stage: DiagnosticStage;
  durationMs: number;
  chunks: number;
  bytes: number;
  cancelled?: boolean;
  errorName?: string;
  errorMessage?: string;
}

const LIMIT = 24;
const records: TransportRecord[] = [];
const listeners = new Set<() => void>();
let sequence = 0;
let snapshot: readonly TransportRecord[] = [];

function notify() {
  snapshot = records.map((record) => ({ ...record }));
  for (const listener of listeners) listener();
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value, "https://localhost");
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split("?")[0]?.slice(0, 160) ?? "";
  }
}

/** Request ids are diagnostic only; they are never sent as a custom CORS header. */
export function diagnosticId(): string {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID().slice(0, 12);
  sequence += 1;
  return `req-${Date.now().toString(36)}-${sequence}`;
}

/** Redact anything that looks like a credential and cap the message. */
export function safeDiagnosticMessage(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-<redacted>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function classifyStatus(status: number): DiagnosticKind {
  if (status === 401) return "http-401";
  if (status === 403) return "http-403";
  if (status === 404) return "http-404";
  if (status === 429) return "http-429";
  if (status >= 500) return "http-5xx";
  if (status >= 400) return "http-other";
  return "provider";
}

/**
 * The browser intentionally hides whether a failed fetch was CORS, DNS or TLS; all it
 * exposes is a TypeError. Native transports do surface the platform exception, so the
 * classifier keeps those names where available instead of pretending to know more.
 */
export function classifyFetchError(error: unknown): DiagnosticKind {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  const name = (error as Error)?.name ?? "";
  const message = String((error as Error)?.message ?? "");
  if (name === "AbortError") return "abort";
  if (name === "TimeoutError") return "timeout";
  if (/UnknownHost|ENOTFOUND|EAI_AGAIN|nslookup/i.test(message)) return "dns";
  if (/SSL|TLS|certificate|CertPathValidator/i.test(message)) return "tls";
  if (/CORS|cross-origin|Access-Control/i.test(message)) return "cors";
  return "network-or-cors";
}

export type TransportPatch = {
  [K in keyof TransportRecord]?: TransportRecord[K] | undefined;
};

export function beginTransport(input: { transport: TransportName; method: string; url: string }): {
  id: string;
  finish: (patch: TransportPatch) => void;
} {
  const record: TransportRecord = {
    id: diagnosticId(),
    at: Date.now(),
    platform: isNativeApp() ? "native" : "web",
    transport: input.transport,
    method: input.method,
    url: safeUrl(input.url),
    stage: "request",
    durationMs: 0,
    chunks: 0,
    bytes: 0,
  };
  const started = performance.now();
  records.unshift(record);
  records.splice(LIMIT);
  notify();
  // The array identity only changes when a record changes, so useSyncExternalStore
  // re-renders exactly once per update rather than on every render.

  return {
    id: record.id,
    finish(patch) {
      Object.assign(record, patch as Partial<TransportRecord>, {
        durationMs: Math.round(performance.now() - started),
      });
      notify();
    },
  };
}

export function transportSnapshot(): readonly TransportRecord[] {
  return snapshot;
}

export function subscribeTransport(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function lastTransport(): TransportRecord | undefined {
  return records[0];
}

export function diagnosticsText(): string {
  const recordsText = records
    .map((record) =>
      [
        `${record.id} ${record.at} ${record.platform} ${record.transport} ${record.method} ${record.url}`,
        `stage=${record.stage} status=${record.status ?? "-"} type=${record.contentType ?? "-"}`,
        `kind=${record.kind ?? "-"} duration=${record.durationMs}ms chunks=${record.chunks} bytes=${record.bytes}`,
        record.errorName || record.errorMessage
          ? `error=${record.errorName ?? ""} ${record.errorMessage ?? ""}`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .join("\n");
  const platform = isNativeApp() ? "android" : "web";
  return [
    `today ${import.meta.env["VITE_APP_VERSION"] ?? "dev"} · ${platform}`,
    typeof navigator !== "undefined" ? navigator.userAgent : "",
    recordsText,
  ].join("\n");
}

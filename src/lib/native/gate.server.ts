/**
 * The Android app runs its UI from a local origin (`https://localhost`), so every
 * request to the real server is cross-origin. This module is the one gate for those
 * requests: an exact origin allowlist, an explicit preflight, and a refusal that says
 * nothing about the deployment.
 *
 * CORS is not authentication. The native endpoints reuse the same admission, size and
 * rate limits as the web routes; the origin list only stops an arbitrary web page from
 * spending this deployment's provider keys from a visitor's browser. A packaged app can
 * be inspected and its requests replayed — that is why no shared secret is embedded in
 * the APK and why abuse protection still belongs at the hosting edge.
 */

const DEFAULT_ORIGINS = ["https://localhost", "capacitor://localhost"];
/** Browser preview only: the installed app is always https://localhost. */
const DEVELOPMENT_ORIGINS = ["http://localhost"];

/**
 * Fail closed. The worker bundle is not guaranteed to define NODE_ENV, so "not production"
 * would have kept the browser origin in the deployed allowlist (A5-09). Only an explicit
 * development/test environment gets it.
 */
function isDevelopment(): boolean {
  const environment = process.env["NODE_ENV"];
  return environment === "development" || environment === "test";
}

/** Origins the installed app is allowed to call from. Extra hosts come from the server env. */
export function nativeOrigins(): string[] {
  const extra = (process.env["NATIVE_ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaults = isDevelopment() ? [...DEFAULT_ORIGINS, ...DEVELOPMENT_ORIGINS] : DEFAULT_ORIGINS;
  return [...new Set([...defaults, ...extra])];
}

export interface NativeGate {
  origin: string;
  headers: Record<string, string>;
}

/** Null when the request did not come from an allowed app origin. */
export function nativeGate(request: Request): NativeGate | null {
  const origin = request.headers.get("Origin");
  if (!origin || !nativeOrigins().includes(origin)) return null;
  return {
    origin,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Max-Age": "600",
      "Access-Control-Expose-Headers": "Retry-After, X-Translation-Writer",
      Vary: "Origin",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  };
}

function denied(): Response {
  return new Response(JSON.stringify({ ok: false, kind: "input" }), {
    status: 403,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

/** Answer a preflight without touching a provider or a budget. */
export function nativePreflight(request: Request): Response {
  const gate = nativeGate(request);
  if (!gate) return denied();
  return new Response(null, { status: 204, headers: gate.headers });
}

/** Merge the gate's headers into whatever the shared handler produced. */
export function withNativeCors(response: Response, gate: NativeGate): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(gate.headers)) headers.set(k, v);
  // A 204 has no body; passing null keeps undici/Workers from complaining.
  return new Response(response.status === 204 ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Run a shared handler behind the gate. The handler keeps its own validation, admission
 * and provider logic; only the authorization check and the CORS headers differ from web.
 */
export async function nativeEndpoint(
  request: Request,
  run: (gate: NativeGate) => Promise<Response> | Response,
): Promise<Response> {
  const gate = nativeGate(request);
  if (!gate) return denied();
  try {
    return withNativeCors(await run(gate), gate);
  } catch {
    // Never leak an internal message to the app; the client maps a bare failure to a
    // calm retry. No text, key or stack trace is logged here.
    return withNativeCors(Response.json({ ok: false, kind: "provider" }, { status: 502 }), gate);
  }
}

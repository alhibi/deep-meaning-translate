import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";

export const assemblyToken = createServerFn({ method: "POST" }).handler(async () => {
  setResponseHeader("Cache-Control", "no-store");
  const request = getRequest();
  const origin = request.headers.get("Origin");
  // Intentionally public app, matching translation: this blocks cross-site browser spending, not bots.
  if (origin && origin !== new URL(request.url).origin) return { ok: false as const, message: "Cross-site microphone requests are not allowed.", status: 403 };
  const key = process.env["ASSEMBLYAI_API_KEY"];
  if (!key) return { ok: false as const, message: "AssemblyAI is not configured.", status: 503 };
  try {
    const response = await fetch("https://streaming.assemblyai.com/v3/token?expires_in_seconds=60", {
      headers: { Authorization: key }, signal: AbortSignal.timeout(15000),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : `AssemblyAI request failed (${response.status}).`;
      return { ok: false as const, status: response.status, message };
    }
    if (!data || typeof data !== "object" || !("token" in data) || typeof data.token !== "string") return { ok: false as const, status: 502, message: "AssemblyAI returned an invalid session." };
    return { ok: true as const, token: data.token };
  } catch {
    return { ok: false as const, status: 502, message: "Could not connect to AssemblyAI." };
  }
});
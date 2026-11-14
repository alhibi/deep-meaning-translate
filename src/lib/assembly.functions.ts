import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { clientAddress, sameOrigin } from "./requestSafety";
import { takeDictationToken } from "./translation/throttle";

export const assemblyToken = createServerFn({ method: "POST" }).handler(async () => {
  setResponseHeader("Cache-Control", "no-store");
  const request = getRequest();
  // Intentionally public app, matching translation: this blocks cross-site browser spending, not bots.
  if (!sameOrigin(request))
    return {
      ok: false as const,
      message: "Cross-site microphone requests are not allowed.",
      status: 403,
    };
  if (!takeDictationToken(clientAddress(request)))
    return {
      ok: false as const,
      message: "Too many dictation sessions. Wait a moment and try again.",
      status: 429,
    };
  const key = process.env["ASSEMBLYAI_API_KEY"];
  if (!key) return { ok: false as const, message: "AssemblyAI is not configured.", status: 503 };
  try {
    const response = await fetch(
      "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60",
      {
        headers: { Authorization: key },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) {
      // Never surface a provider body: only the status is ours to report.
      void response.body?.cancel().catch(() => {});
      console.warn("[assembly] provider status", response.status);
      return {
        ok: false as const,
        status: response.status,
        message: "AssemblyAI is unavailable right now.",
      };
    }
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("token" in data) || typeof data.token !== "string")
      return {
        ok: false as const,
        status: 502,
        message: "AssemblyAI returned an invalid session.",
      };
    return { ok: true as const, token: data.token };
  } catch {
    return { ok: false as const, status: 502, message: "Could not connect to AssemblyAI." };
  }
});

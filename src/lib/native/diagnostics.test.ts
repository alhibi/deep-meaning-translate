import { describe, expect, it } from "vitest";
import {
  beginTransport,
  classifyFetchError,
  classifyStatus,
  diagnosticId,
  diagnosticsText,
  safeDiagnosticMessage,
  transportSnapshot,
} from "./diagnostics";

describe("transport diagnostics", () => {
  it("classifies HTTP statuses without collapsing them into provider", () => {
    expect(classifyStatus(401)).toBe("http-401");
    expect(classifyStatus(403)).toBe("http-403");
    expect(classifyStatus(404)).toBe("http-404");
    expect(classifyStatus(429)).toBe("http-429");
    expect(classifyStatus(502)).toBe("http-5xx");
    expect(classifyStatus(400)).toBe("http-other");
  });

  it("keeps abort/timeout/offline and browser-opaque network failures distinct", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect(classifyFetchError(abort)).toBe("abort");
    expect(classifyFetchError(timeout)).toBe("timeout");
    expect(classifyFetchError(new TypeError("Failed to fetch"))).toBe("network-or-cors");
  });

  it("records metadata but never the request text or a key", () => {
    const handle = beginTransport({
      transport: "webview-fetch",
      method: "POST",
      url: "https://fluently.today/api/native/v1/translate-stream?secret=1",
    });
    handle.finish({ stage: "done", status: 200, chunks: 3, bytes: 42 });
    const last = transportSnapshot()[0];
    expect(last?.url).toBe("https://fluently.today/api/native/v1/translate-stream");
    expect(last?.status).toBe(200);
    expect(last?.chunks).toBe(3);
    expect(last?.bytes).toBe(42);
    expect(diagnosticsText()).not.toContain("secret=1");
    expect(diagnosticsText()).not.toContain("Hallo");
  });

  it("redacts bearer tokens and key-shaped strings from error messages", () => {
    expect(safeDiagnosticMessage("Bearer sk-abcdefghijklmnop failed")).not.toContain(
      "abcdefghijklmnop",
    );
    expect(safeDiagnosticMessage("Authorization: Bearer abc.def.ghi")).toContain("<redacted>");
  });

  it("creates non-empty, bounded request ids", () => {
    const id = diagnosticId();
    expect(id.length).toBeGreaterThan(5);
    expect(id.length).toBeLessThanOrEqual(32);
  });
});

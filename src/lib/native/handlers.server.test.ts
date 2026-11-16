// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nativeLexicon, nativeRepair, nativeShadow } from "./handlers.server";

const url = "https://fluently.today/api/native/v1/repair";

function oversized(bodySize = 200_000): Request {
  return new Request(url, {
    method: "POST",
    headers: { Origin: "https://localhost", "Content-Type": "application/json" },
    body: "x".repeat(bodySize),
  });
}

/**
 * A5-01 regression: every native handler must bound the body before it parses or spends
 * an admission token. A huge unauthenticated body used to be buffered and JSON.parsed.
 */
describe("native handlers bound their request body", () => {
  it("refuses an oversized repair body as input without provider work", async () => {
    for (let i = 0; i < 3; i++) {
      const response = await nativeRepair(oversized());
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, kind: "input" });
    }
  });

  it("refuses oversized lexicon and shadow bodies as input", async () => {
    const lexicon = await nativeLexicon(oversized());
    expect(lexicon.status).toBe(400);
    expect(await lexicon.json()).toEqual({ ok: false, kind: "input" });
    const shadow = await nativeShadow(oversized());
    expect(shadow.status).toBe(400);
    expect(await shadow.json()).toEqual({ ok: false, kind: "input" });
  });

  it("still refuses a malformed small body as input", async () => {
    const response = await nativeRepair(
      new Request(url, {
        method: "POST",
        headers: { Origin: "https://localhost", "Content-Type": "application/json" },
        body: JSON.stringify({ request: { text: "" }, previous: null }),
      }),
    );
    expect(response.status).toBe(400);
  });
});

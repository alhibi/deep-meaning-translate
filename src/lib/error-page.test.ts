import { describe, expect, it } from "vitest";
import { renderErrorPage } from "./error-page";

/**
 * This page is served when rendering the app itself failed — the one moment the app
 * cannot rescue the user. It must be self-contained (nothing to load) and speak the
 * same calm language as every in-app error.
 */
describe("fallback error page", () => {
  const html = renderErrorPage();

  it("is a complete, standalone document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).toContain("viewport");
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("loads nothing from the network", () => {
    // No external script/style/font/image can fail and leave an empty screen.
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/@import/i);
  });

  it("offers exactly two calm actions: try again, go home", () => {
    expect(html).toContain("location.reload()");
    expect(html).toContain('href="/"');
    expect(html).toContain("This page didn't load");
    // No status codes, no exception names, no stack traces in front of a person.
    expect(html).not.toMatch(/internal server error|stack trace|typeerror|referenceerror/i);
    expect(html).not.toMatch(/>\s*5\d\d\s*</);
  });

  it("declares the language and stays legible", () => {
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("prefers-color-scheme");
  });
});

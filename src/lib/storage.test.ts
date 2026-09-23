import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("saved phrases", () => {
  it("saves, finds and toggles off", async () => {
    const { saved } = await import("./saved");
    const e = { source: "de", target: "ar", original: "Hallo  Welt", translated: "مرحبا" };
    expect(saved.toggle(e)).toBe(true);
    expect(saved.find("Hallo Welt", "ar")).toBeTruthy();
    expect(saved.toggle(e)).toBe(false);
    expect(saved.list()).toHaveLength(0);
  });
  it("drops damaged rows instead of crashing", async () => {
    localStorage.setItem("lingua.saved.v1", JSON.stringify([null, 5, { id: "x" }]));
    const { saved } = await import("./saved");
    expect(saved.list()).toEqual([]);
    expect(saved.ofTheDay()).toBeNull();
  });
  it("survives invalid JSON", async () => {
    localStorage.setItem("lingua.saved.v1", "{broken");
    const { saved } = await import("./saved");
    expect(saved.list()).toEqual([]);
  });
});

describe("history", () => {
  it("merges a sentence that grew while typing", async () => {
    const { history } = await import("./history");
    history.add({ source: "de", target: "ar", original: "Hallo", translated: "مرحبا" });
    const list = history.add({ source: "de", target: "ar", original: "Hallo Welt", translated: "مرحبا يا عالم" });
    expect(list).toHaveLength(1);
  });
  it("drops damaged rows", async () => {
    localStorage.setItem("lingua.history.v1", JSON.stringify([{ bad: 1 }, "x"]));
    const { history } = await import("./history");
    expect(history.list()).toEqual([]);
  });
});

describe("session", () => {
  it("survives invalid JSON", async () => {
    localStorage.setItem("lingua.session.v1", "{broken");
    const { persist } = await import("./persist");
    expect(() => persist.session()).not.toThrow();
  });
});

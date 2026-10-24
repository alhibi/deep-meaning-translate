import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("saved phrases", () => {
  it("a clear in another tab cannot resurrect cached phrases on the next save", async () => {
    const { saved, useSaved } = await import("./saved");
    saved.toggle({ source: "de", target: "ar", original: "Alt", translated: "قديم" });
    const { result, unmount } = renderHook(() => useSaved());
    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(result.current).toEqual([]);
    act(() => {
      saved.toggle({ source: "de", target: "ar", original: "Neu", translated: "جديد" });
    });
    expect(saved.list().map((p) => p.original)).toEqual(["Neu"]);
    unmount();
  });
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
  it("rejects timestamps outside the Date range and removes invalid update dates", async () => {
    localStorage.setItem(
      "lingua.history.v1",
      JSON.stringify([
        { id: "bad", source: "de", target: "ar", original: "A", translated: "ب", createdAt: 1e20 },
        {
          id: "good",
          source: "de",
          target: "ar",
          original: "A",
          translated: "ب",
          createdAt: 1,
          updatedAt: 1e20,
        },
      ]),
    );
    const { history } = await import("./history");
    expect(history.list()).toHaveLength(1);
    expect(history.list()[0]?.id).toBe("good");
    expect(history.list()[0]?.updatedAt).toBeUndefined();
  });
  it("merges a sentence that grew while typing", async () => {
    const { history } = await import("./history");
    history.add({ source: "de", target: "ar", original: "Hallo", translated: "مرحبا" });
    const list = history.add({
      source: "de",
      target: "ar",
      original: "Hallo Welt",
      translated: "مرحبا يا عالم",
    });
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

describe("data integrity (edit, delete, restore)", () => {
  it("edits a saved translation and refuses empty edits", async () => {
    const { saved } = await import("./saved");
    saved.toggle({ source: "de", target: "ar", original: "Danke", translated: "شكرا" });
    const id = saved.list()[0]!.id;
    expect(saved.update(id, "  شكراً جزيلاً ")).toBe(true);
    expect(saved.update(id, "   ")).toBe(false);
    expect(saved.update("missing", "x")).toBe(false);
    vi.resetModules();
    const fresh = (await import("./saved")).saved;
    expect(fresh.list()[0]!.translated).toBe("شكراً جزيلاً");
  });
  it("deletes one history entry and keeps the rest across reloads", async () => {
    const { history } = await import("./history");
    history.add({ source: "de", target: "ar", original: "Eins", translated: "واحد" });
    const list = history.add({ source: "de", target: "en", original: "Zwei", translated: "two" });
    const left = history.remove(list[0]!.id);
    expect(left.map((e) => e.original)).toEqual(["Eins"]);
    vi.resetModules();
    expect((await import("./history")).history.list().map((e) => e.original)).toEqual(["Eins"]);
  });
  it("clearing the phrasebook also clears what is held in memory", async () => {
    const { saved } = await import("./saved");
    saved.toggle({ source: "de", target: "ar", original: "Ja", translated: "نعم" });
    localStorage.clear();
    saved.clear();
    expect(saved.list()).toEqual([]);
    expect(localStorage.getItem("lingua.saved.v1")).toBe("[]");
  });
  it("rejects damaged or foreign prefs that the server would refuse", async () => {
    const { persist } = await import("./persist");
    localStorage.setItem(
      "lingua.prefs.v1",
      JSON.stringify({ source: "de", target: "ar", style: "weird" }),
    );
    expect(persist.prefs()).toBeNull();
    localStorage.setItem(
      "lingua.prefs.v1",
      JSON.stringify({ source: "de", target: "auto", style: "natural" }),
    );
    expect(persist.prefs()).toBeNull();
    localStorage.setItem(
      "lingua.prefs.v1",
      JSON.stringify({ source: "auto", target: "ar", style: "formal", dialect: "mars" }),
    );
    expect(persist.prefs()).toEqual({ source: "auto", target: "ar", style: "formal" });
  });
  it("restores a session round-trip and drops a damaged cached result", async () => {
    const { persist } = await import("./persist");
    persist.saveSession({
      text: "Hallo",
      result: null,
      source: "de",
      target: "ar",
      style: "natural",
    });
    expect(persist.session()?.text).toBe("Hallo");
    localStorage.setItem(
      "lingua.session.v1",
      JSON.stringify({
        text: "Hallo",
        result: { translation: 5 },
        source: "de",
        target: "ar",
        style: "natural",
      }),
    );
    expect(persist.session()?.result).toBeNull();
    localStorage.setItem("lingua.session.v1", JSON.stringify({ text: 42 }));
    expect(persist.session()).toBeNull();
    persist.saveSession({
      text: "   ",
      result: null,
      source: "de",
      target: "ar",
      style: "natural",
    });
    expect(localStorage.getItem("lingua.session.v1")).toBeNull();
  });
});

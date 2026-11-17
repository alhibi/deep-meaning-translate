import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("saved phrases", () => {
  it("a clear in another tab cannot resurrect cached phrases on the next save", async () => {
    const { saved, useSaved } = await import("./saved");
    await saved.toggle({ source: "de", target: "ar", original: "Alt", translated: "قديم" });
    const { result, unmount } = renderHook(() => useSaved());
    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(result.current).toEqual([]);
    act(async () => {
      await saved.toggle({ source: "de", target: "ar", original: "Neu", translated: "جديد" });
    });
    expect(saved.list().map((p) => p.original)).toEqual(["Neu"]);
    unmount();
  });
  it("saves, finds and toggles off", async () => {
    const { saved } = await import("./saved");
    const e = { source: "de", target: "ar", original: "Hallo  Welt", translated: "مرحبا" };
    await expect(saved.toggle(e)).resolves.toBe(true);
    expect(saved.find("Hallo Welt", "ar")).toBeTruthy();
    await expect(saved.toggle(e)).resolves.toBe(false);
    expect(saved.list()).toHaveLength(0);
  });
  it("drops damaged rows instead of crashing", async () => {
    localStorage.setItem("lingua.saved.v1", JSON.stringify([null, 5, { id: "x" }]));
    const { saved } = await import("./saved");
    expect(saved.list()).toEqual([]);
    expect(saved.ofTheDay("2026-11-14")).toBeNull();
  });
  it("selects the daily phrase from an explicit day key", async () => {
    const { saved } = await import("./saved");
    await saved.toggle({ source: "de", target: "ar", original: "A", translated: "أ" });
    await saved.toggle({ source: "de", target: "ar", original: "B", translated: "ب" });
    const first = saved.ofTheDay("2026-11-14");
    const second = saved.ofTheDay("2026-11-15");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.id).not.toBe(second?.id);
  });
  it("survives invalid JSON", async () => {
    localStorage.setItem("lingua.saved.v1", "{broken");
    const { saved } = await import("./saved");
    expect(saved.list()).toEqual([]);
  });
  it("normalises each phrase once, not on every render lookup", async () => {
    // The translator asks "is this draft saved?" during render; the phrasebook can hold
    // 300 phrases, so a per-render scan would normalise every phrase on every keystroke.
    const rows = Array.from({ length: 300 }, (_, i) => ({
      id: `p${i}`,
      source: "de",
      target: "ar",
      original: `Phrase ${i}`,
      translated: "جملة",
      createdAt: 1,
      known: 0,
      reviewedAt: 0,
    }));
    localStorage.setItem("lingua.saved.v1", JSON.stringify(rows));
    const { saved } = await import("./saved");
    expect(saved.list()).toHaveLength(300);
    const replace = vi.spyOn(String.prototype, "replace");
    for (let i = 0; i < 100; i++) expect(saved.find("Phrase 299", "ar")?.id).toBe("p299");
    const normalisations = replace.mock.calls.length;
    replace.mockRestore();
    // One index build (300) plus one query normalisation per call (100), not 300 per call.
    expect(normalisations).toBeLessThan(500);
  });
  it("keeps the phrasebook bounded over a long session loop", async () => {
    const { saved } = await import("./saved");
    for (let i = 0; i < 310; i++)
      await saved.toggle({
        source: "de",
        target: "ar",
        original: `Phrase der Sitzung ${i} ${"p".repeat(4)}`,
        translated: `عبارة الجلسة ${i}`,
      });
    expect(saved.list()).toHaveLength(300);
    const stored = localStorage.getItem("lingua.saved.v1") ?? "";
    expect(stored.length).toBeLessThan(200_000);
    expect(stored.length).toBeGreaterThan(0);
  });

  it("does not overwrite phrases another tab saved since this tab's last read", async () => {
    const { saved } = await import("./saved");
    await saved.toggle({ source: "de", target: "ar", original: "Meins", translated: "لي" });
    const otherRow = {
      id: "other-phrase",
      source: "de",
      target: "ar",
      original: "Andere",
      translated: "آخر",
      createdAt: 900,
      known: 0,
      reviewedAt: 0,
    };
    localStorage.setItem("lingua.saved.v1", JSON.stringify([otherRow]));

    await saved.toggle({ source: "de", target: "ar", original: "Neu", translated: "جديد" });

    const originals = saved.list().map((p) => p.original);
    expect(originals).toContain("Andere");
    expect(originals).toContain("Neu");
    expect(originals).toHaveLength(2);
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
    await history.add({ source: "de", target: "ar", original: "Hallo", translated: "مرحبا" });
    const list = await history.add({
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
  it("drops a cached result written into a different target language", async () => {
    // A model can name the wrong target; storing that result and restoring it as the
    // session's translation hides a translation into the wrong language on return.
    localStorage.setItem(
      "lingua.session.v1",
      JSON.stringify({
        text: "Hallo",
        result: {
          sourceLanguage: "de",
          targetLanguage: "ar",
          translation: "مرحبا",
          tone: "",
          formality: "",
          confidence: 1,
          isAmbiguous: false,
          alternativeTranslations: [],
          notes: "",
        },
        source: "de",
        target: "de",
        style: "natural",
      }),
    );
    const { persist } = await import("./persist");
    expect(persist.session()?.result).toBeNull();
  });
  it("drops a cached result missing required result fields", async () => {
    localStorage.setItem(
      "lingua.session.v1",
      JSON.stringify({
        text: "Hallo",
        result: {
          sourceLanguage: "de",
          targetLanguage: "ar",
          translation: "مرحبا",
          alternativeTranslations: [],
        },
        source: "de",
        target: "ar",
        style: "natural",
      }),
    );
    const { persist } = await import("./persist");
    expect(persist.session()?.result).toBeNull();
  });
  it("keeps a cached result that belongs to the session target", async () => {
    localStorage.setItem(
      "lingua.session.v1",
      JSON.stringify({
        text: "Hallo",
        result: {
          sourceLanguage: "de",
          targetLanguage: "ar",
          translation: "مرحبا",
          tone: "",
          formality: "",
          confidence: 1,
          isAmbiguous: false,
          alternativeTranslations: [],
          notes: "",
        },
        source: "de",
        target: "ar",
        style: "natural",
      }),
    );
    const { persist } = await import("./persist");
    expect(persist.session()?.result?.translation).toBe("مرحبا");
  });
  it("remembers this tab's last values for a route that mounts again", async () => {
    vi.resetModules();
    const { persist } = await import("./persist");
    persist.saveSession({
      text: "Hallo",
      result: null,
      source: "de",
      target: "ar",
      style: "natural",
    });
    persist.savePrefs({ source: "de", target: "ar", style: "natural" });
    expect(persist.remembered().session?.text).toBe("Hallo");
    expect(persist.remembered().prefs?.target).toBe("ar");
    persist.clearAll();
    expect(persist.remembered()).toEqual({ prefs: null, session: null });
  });
});

describe("data integrity (edit, delete, restore)", () => {
  it("edits a saved translation and refuses empty edits", async () => {
    const { saved } = await import("./saved");
    await saved.toggle({ source: "de", target: "ar", original: "Danke", translated: "شكرا" });
    const id = saved.list()[0]!.id;
    await expect(saved.update(id, "  شكراً جزيلاً ")).resolves.toBe(true);
    await expect(saved.update(id, "   ")).resolves.toBe(false);
    await expect(saved.update("missing", "x")).resolves.toBe(false);
    vi.resetModules();
    const fresh = (await import("./saved")).saved;
    expect(fresh.list()[0]!.translated).toBe("شكراً جزيلاً");
  });
  it("deletes one history entry and keeps the rest across reloads", async () => {
    const { history } = await import("./history");
    await history.add({ source: "de", target: "ar", original: "Eins", translated: "واحد" });
    const list = await history.add({
      source: "de",
      target: "en",
      original: "Zwei",
      translated: "two",
    });
    const left = await history.remove(list[0]!.id);
    expect(left.map((e) => e.original)).toEqual(["Eins"]);
    vi.resetModules();
    expect((await import("./history")).history.list().map((e) => e.original)).toEqual(["Eins"]);
  });
  it("clearing the phrasebook also clears what is held in memory", async () => {
    const { saved } = await import("./saved");
    await saved.toggle({ source: "de", target: "ar", original: "Ja", translated: "نعم" });
    localStorage.clear();
    await saved.clear();
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
    await persist.saveSession({
      text: "   ",
      result: null,
      source: "de",
      target: "ar",
      style: "natural",
    });
    // TD14: an empty draft is an empty record, not a deletion, so a stale tab cannot erase
    // another tab's newer draft. The app still sees no draft.
    expect(persist.session()).toBeNull();
    expect(localStorage.getItem("lingua.session.v1")).not.toBeNull();
  });
});

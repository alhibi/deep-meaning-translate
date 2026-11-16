import { webcrypto } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_SETTING_KEYS, type HistoryEntry, type Session } from "./contracts";
import { countOf, createBackup, mergeData, parseBackup } from "./backup";
import {
  nextSessionTimestamp,
  readSessionMeta,
  readSessionRecord,
  webPort,
  writeSessionState,
} from "./web";
import { persist, resetPersistCache, resetPersistRecency } from "../persist";

/**
 * The port's contract on the web adapter, plus the backup envelope that both platforms
 * share. These are the rules a restore depends on: validated reads, one row per id,
 * digest-checked files, and merge/replace that never leave a half-imported archive.
 */

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  }
});

const entry = (id: string, original: string, createdAt: number): HistoryEntry => ({
  id,
  source: "de",
  target: "ar",
  original,
  translated: `ترجمة ${id}`,
  createdAt,
  updatedAt: createdAt,
  uses: 1,
});

const session: Session = {
  text: "Guten Tag",
  result: null,
  source: "de",
  target: "ar",
  style: "natural",
};

const SESSION_KEY = "lingua.session.v1";

const withText = (text: string): Session => ({ ...session, text });

describe("web persistence adapter", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await webPort.clearAll();
  });

  it("hydrates empty, then returns what was written", async () => {
    expect((await webPort.hydrate()).history).toEqual([]);
    await webPort.historyUpsert([entry("a", "Hallo", 1_000)]);
    await webPort.saveSession(session);
    const hydrated = await webPort.hydrate();
    expect(hydrated.history.map((r) => r.id)).toEqual(["a"]);
    expect(hydrated.session?.text).toBe("Guten Tag");
  });

  it("keeps one row per id and the newest first", async () => {
    await webPort.historyUpsert([entry("a", "Hallo", 1_000), entry("b", "Tschüss", 2_000)]);
    await webPort.historyUpsert([{ ...entry("a", "Hallo", 1_000), translated: "مرحبا" }]);
    const rows = await webPort.historyAll();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe("b");
    expect(rows.find((r) => r.id === "a")?.translated).toBe("مرحبا");
  });

  it("clears the session only when asked, and clears records on clearAll", async () => {
    await webPort.saveSession(session);
    await webPort.saveSession(null);
    expect((await webPort.hydrate()).session).toBeNull();

    await webPort.historyUpsert([entry("a", "Hallo", 1_000)]);
    await webPort.clearAll();
    expect((await webPort.hydrate()).history).toEqual([]);
  });

  it("reads a legacy bare session unchanged and upgrades it on the next save", async () => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    expect(readSessionMeta()).toBeNull();
    expect((await webPort.hydrate()).session).toEqual(session);
    await webPort.saveSession(session);
    expect(readSessionMeta()?.at).toBeGreaterThan(0);
  });

  it("round-trips the session through its recency envelope", async () => {
    await webPort.saveSession(session);
    const raw = JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? "null") as {
      at?: unknown;
      origin?: unknown;
    };
    expect(typeof raw.at).toBe("number");
    expect(typeof raw.origin).toBe("string");
    expect(raw.at).toBe(readSessionMeta()?.at);
    expect((await webPort.hydrate()).session).toEqual(session);
    const snapshot = await webPort.snapshot();
    expect(snapshot.session).toEqual(session);
    // A backup carries the validated draft, never the tab metadata.
    expect(Object.keys(snapshot.session ?? {})).not.toContain("at");
    expect(Object.keys(snapshot.session ?? {})).not.toContain("origin");
  });

  it("keeps an empty draft as a record that resolves to no session", async () => {
    await webPort.saveSession(session);
    await webPort.saveSession(null);
    expect(window.localStorage.getItem(SESSION_KEY)).not.toBeNull();
    expect(readSessionRecord()).toBeNull();
    expect(readSessionMeta()?.at).toBeGreaterThan(0);
    expect((await webPort.hydrate()).session).toBeNull();
    expect((await webPort.snapshot()).session).toBeNull();
  });

  it("merges without duplicating and keeps the newer row", async () => {
    await webPort.historyUpsert([{ ...entry("same", "Hallo", 5_000), translated: "قديم" }]);
    const before = await webPort.snapshot();
    const incoming = {
      settings: {},
      prefs: before.prefs,
      session: before.session,
      history: [
        { ...entry("same", "Hallo", 1_000), translated: "جديد" },
        entry("new", "Welt", 2_000),
      ],
      saved: [],
      memory: [],
    };
    const report = await webPort.replaceAll(incoming, "merge");
    expect(report.added.history).toBe(1);
    expect(report.skipped.history).toBe(1);
    const rows = await webPort.historyAll();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === "same")?.translated).toBe("قديم");
  });

  it("replace removes the previous archive and settings the file does not carry", async () => {
    const [keep, drop] = BACKUP_SETTING_KEYS;
    await webPort.historyUpsert([entry("old", "Alt", 1_000)]);
    window.localStorage.setItem(drop!, "de");
    const report = await webPort.replaceAll(
      {
        settings: { [keep!]: "light" },
        prefs: null,
        session: null,
        history: [entry("fresh", "Neu", 2_000)],
        saved: [],
        memory: [],
      },
      "replace",
    );
    expect(report.added.history).toBe(1);
    expect((await webPort.historyAll()).map((r) => r.id)).toEqual(["fresh"]);
    expect(window.localStorage.getItem(drop!)).toBeNull();
  });

  it("rejects an import and restores every prior store when a later write is refused", async () => {
    await webPort.historyUpsert([entry("old", "Alt", 1_000)]);
    await webPort.savedWrite([
      {
        id: "saved-old",
        source: "de",
        target: "ar",
        original: "Alt",
        translated: "قديم",
        createdAt: 1_000,
        known: 0,
        reviewedAt: 0,
      },
    ]);
    const realSetItem = Storage.prototype.setItem;
    let refuseImportSavedWrite = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "lingua.saved.v1" && refuseImportSavedWrite) {
        refuseImportSavedWrite = false;
        throw new DOMException("QuotaExceededError");
      }
      return realSetItem.call(this, key, value);
    });

    await expect(
      webPort.replaceAll(
        {
          settings: {},
          prefs: null,
          session: null,
          history: [entry("new", "Neu", 2_000)],
          saved: [],
          memory: [],
        },
        "replace",
      ),
    ).rejects.toThrow("import-failed");

    expect((await webPort.historyAll()).map((row) => row.id)).toEqual(["old"]);
    expect((await webPort.hydrate()).saved.map((row) => row.id)).toEqual(["saved-old"]);
  });
});

describe("backup envelope", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await webPort.clearAll();
  });

  it("round-trips every record with matching counts", async () => {
    await webPort.historyUpsert([entry("a", "Hallo", 1_000)]);
    await webPort.saveSession(session);
    window.localStorage.setItem(BACKUP_SETTING_KEYS[0]!, "dark");
    const snapshot = await webPort.snapshot();

    const envelope = await createBackup(snapshot, { appVersion: "1.0.0" });
    const parsed = await parseBackup(JSON.stringify(envelope));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const whitelisted = Object.keys(snapshot.settings).filter((key) =>
      (BACKUP_SETTING_KEYS as readonly string[]).includes(key),
    ).length;
    expect(parsed.counts).toEqual({
      history: 1,
      saved: 0,
      memory: 0,
      settings: whitelisted,
    });
    expect(countOf(parsed.data)).toEqual(parsed.counts);
    expect(parsed.data.history[0]?.original).toBe("Hallo");
    expect(parsed.data.session?.text).toBe("Guten Tag");
    expect(parsed.data.settings[BACKUP_SETTING_KEYS[0]!]).toBe("dark");
  });

  it("refuses a file changed after export", async () => {
    await webPort.historyUpsert([entry("a", "Hallo", 1_000)]);
    const envelope = await createBackup(await webPort.snapshot(), { appVersion: "1.0.0" });
    const tampered = JSON.parse(JSON.stringify(envelope)) as typeof envelope;
    tampered.data!.history[0]!.original = "Manipuliert";
    const parsed = await parseBackup(JSON.stringify(tampered));
    expect(parsed).toEqual({ ok: false, reason: "integrity" });
  });

  it("refuses a newer schema version and non-backup JSON", async () => {
    const envelope = await createBackup(
      { history: [], saved: [], memory: [] },
      { appVersion: "1.0.0" },
    );
    expect(await parseBackup(JSON.stringify({ ...envelope, schemaVersion: 99 }))).toEqual({
      ok: false,
      reason: "version",
    });
    expect(await parseBackup('{"hello":true}')).toEqual({ ok: false, reason: "format" });
    expect(await parseBackup("not json")).toEqual({ ok: false, reason: "damaged" });
  });

  it("encrypts with a password and refuses the wrong one", async () => {
    await webPort.historyUpsert([entry("a", "Hallo", 1_000)]);
    const envelope = await createBackup(await webPort.snapshot(), {
      appVersion: "1.0.0",
      password: "correct horse",
    });
    expect(envelope.encrypted).toBe(true);
    expect(envelope.data).toBeNull();

    expect(await parseBackup(JSON.stringify(envelope))).toEqual({ ok: false, reason: "password" });
    expect(await parseBackup(JSON.stringify(envelope), "wrong")).toEqual({
      ok: false,
      reason: "password",
    });
    const parsed = await parseBackup(JSON.stringify(envelope), "correct horse");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.history[0]?.original).toBe("Hallo");
  });

  it("merge is deterministic and never loses a newer local translation", () => {
    const local = {
      settings: {},
      prefs: null,
      session: null,
      history: [{ ...entry("same", "Hallo", 9_000), translated: "محلي" }],
      saved: [],
      memory: [],
    };
    const incoming = {
      settings: {},
      prefs: null,
      session: null,
      history: [{ ...entry("same", "Hallo", 1_000), translated: "وارد" }],
      saved: [],
      memory: [],
    };
    const merged = mergeData(local, incoming);
    expect(merged.data.history[0]?.translated).toBe("محلي");
    expect(merged.report.skipped.history).toBe(1);
  });
});

/**
 * TD14: the pagehide flush writes the tab's current snapshot, and an empty draft used to
 * remove the shared session key — so a second, empty tab that closed could erase another
 * tab's draft. An empty draft is now an empty record, and a write whose recency is older
 * than the stored record is refused. These tests simulate a second tab by writing its
 * record directly: a same-document localStorage write fires no `storage` event, which is
 * exactly the stale case.
 */
describe("session recency across tabs (TD14)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetPersistCache();
    resetPersistRecency();
  });

  it("refuses a stale tab's flush so it cannot clear a newer draft", async () => {
    expect(persist.session()).toBeNull(); // this tab's boot read
    writeSessionState(withText("Neuer Entwurf"), {
      at: Date.now() + 60_000,
      origin: "other-tab",
    });
    const storedAt = readSessionMeta()?.at;

    expect(await persist.saveSession(null)).toBe("refused-stale");
    expect(await persist.saveSession(withText("stale draft"))).toBe("refused-stale");
    expect(readSessionRecord()?.text).toBe("Neuer Entwurf");
    expect(readSessionMeta()?.at).toBe(storedAt);
    // This tab still remembers what it believed, so its own screen is unchanged.
    expect(persist.remembered().session?.text).toBe("stale draft");
  });

  it("adopts a newer draft from a storage event, then the next write wins", async () => {
    expect(persist.session()).toBeNull();
    writeSessionState(withText("Neuer Entwurf"), {
      at: Date.now() + 60_000,
      origin: "other-tab",
    });
    const storedAt = readSessionMeta()?.at ?? 0;

    window.dispatchEvent(new StorageEvent("storage", { key: SESSION_KEY }));

    expect(persist.remembered().session?.text).toBe("Neuer Entwurf");
    expect(await persist.saveSession(withText("mein Entwurf"))).toBe("saved");
    expect(readSessionRecord()?.text).toBe("mein Entwurf");
    expect(readSessionMeta()?.at).toBeGreaterThan(storedAt);
  });

  it("remembers an empty draft instead of deleting the key", async () => {
    expect(await persist.saveSession(null)).toBe("saved");
    expect(readSessionRecord()).toBeNull();
    expect(persist.session()).toBeNull();
    const raw = JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? "null") as {
      text?: unknown;
      at?: unknown;
    };
    expect(raw.text).toBe("");
    expect(typeof raw.at).toBe("number");
  });

  it("clearAll resets the recency epoch so the next write wins", async () => {
    expect(persist.session()).toBeNull();
    writeSessionState(withText("other tab"), { at: Date.now() + 60_000, origin: "other-tab" });
    expect(await persist.saveSession(null)).toBe("refused-stale");

    await persist.clearAll();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();

    expect(await persist.saveSession(withText("nach dem Löschen"))).toBe("saved");
    expect(readSessionRecord()?.text).toBe("nach dem Löschen");
  });
});

describe("cross-tab sync for prefs and session", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetPersistCache();
    resetPersistRecency();
  });

  it("updates remembered prefs from a storage event and notifies subscribers", async () => {
    const calls: string[] = [];
    const unsubscribe = persist.subscribe(() => calls.push("changed"));
    const prefs = { source: "de", target: "en", style: "formal" as const };

    window.localStorage.setItem("lingua.prefs.v1", JSON.stringify(prefs));
    window.dispatchEvent(new StorageEvent("storage", { key: "lingua.prefs.v1" }));

    expect(persist.remembered().prefs).toEqual(prefs);
    expect(calls).toHaveLength(1);

    // A local write notifies the same tab too, so a mounted view can re-read.
    await persist.savePrefs(prefs);
    expect(calls.length).toBeGreaterThan(1);
    unsubscribe();
  });

  it("notifies on a local session write and keeps the snapshot stable between changes", async () => {
    const calls: number[] = [];
    const unsubscribe = persist.subscribe(() => calls.push(1));
    const before = persist.remembered();
    expect(persist.remembered()).toBe(before);
    await persist.saveSession(withText("Hallo"));
    expect(calls).toHaveLength(1);
    expect(persist.remembered().session?.text).toBe("Hallo");
    unsubscribe();
  });

  it("treats a cleared key as a fresh epoch and an empty draft", async () => {
    await persist.saveSession(withText("Hallo"));
    window.localStorage.removeItem(SESSION_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: SESSION_KEY }));
    expect(persist.remembered().session).toBeNull();
    expect(await persist.saveSession(withText("Neu"))).toBe("saved");
  });
});

import { webcrypto } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BACKUP_SETTING_KEYS, type HistoryEntry, type Session } from "./contracts";
import { countOf, createBackup, mergeData, parseBackup } from "./backup";
import { webPort } from "./web";

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

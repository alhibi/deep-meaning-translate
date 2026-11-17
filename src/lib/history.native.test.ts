import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "./persistence/contracts";

/**
 * Native archive read cost. The statistics screen asks for the whole archive once and
 * then re-derives after a tag correction or an exact re-translation; before this cache
 * every one of those revisions fetched up to 2,000 rows over the Capacitor bridge again.
 *
 * The bridge is faked here: the point is how often the store calls it, not Room's SQL.
 */

const bridge = vi.hoisted(() => {
  const state = {
    allCalls: 0,
    upsertCalls: 0,
    deleteCalls: 0,
    trimCalls: 0,
    rows: [] as unknown[],
    deferCandidates: false,
    candidates: [] as { promise: Promise<unknown[]>; resolve: (rows: unknown[]) => void }[],
  };
  return {
    state,
    makeCandidates() {
      let resolve!: (rows: unknown[]) => void;
      const promise = new Promise<unknown[]>((r) => {
        resolve = r;
      });
      state.candidates.push({ promise, resolve });
      return promise;
    },
  };
});

vi.mock("./native/config", () => ({ isNativeApp: () => true }));
vi.mock("./persistence", () => ({
  isNativePersistence: () => true,
  port: {
    kind: "native",
    historyAll: async () => {
      bridge.state.allCalls += 1;
      return bridge.state.rows;
    },
    historyPage: async () => ({ rows: [], total: 0 }),
    historyCandidates: () =>
      bridge.state.deferCandidates ? bridge.makeCandidates() : Promise.resolve([]),
    historyUpsert: async () => {
      bridge.state.upsertCalls += 1;
      return 1;
    },
    historyDelete: async () => {
      bridge.state.deleteCalls += 1;
    },
    historyTrim: async () => {
      bridge.state.trimCalls += 1;
    },
    historyClear: async () => {
      bridge.state.rows = [];
    },
  },
}));

const HOUR = 3_600_000;
const BASE = Date.UTC(2026, 0, 1);

const entry = (i: number): HistoryEntry => ({
  id: `n-${i}`,
  source: "de",
  target: "ar",
  original: `Satz ${i}`,
  translated: `جملة ${i}`,
  createdAt: BASE + i * HOUR,
  updatedAt: BASE + i * HOUR,
  v: 2,
  uses: 1,
});

const rows = (n: number): HistoryEntry[] => Array.from({ length: n }, (_, i) => entry(i));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  const { hydrateHistory } = await import("./history");
  bridge.state.allCalls = 0;
  bridge.state.upsertCalls = 0;
  bridge.state.deleteCalls = 0;
  bridge.state.trimCalls = 0;
  bridge.state.rows = [];
  bridge.state.candidates.length = 0;
  bridge.state.deferCandidates = false;
  hydrateHistory([], 0);
});

describe("native archive reads", () => {
  it("does not refetch the archive when the boot window is the whole archive", async () => {
    const { history, hydrateHistory } = await import("./history");
    bridge.state.rows = rows(3);
    hydrateHistory(rows(3), 3);

    expect(await history.all()).toHaveLength(3);

    expect(bridge.state.allCalls).toBe(0);
  });

  it("does not refetch after a correction once the full archive is known", async () => {
    const { history, hydrateHistory } = await import("./history");
    // Boot carries a 400-row window of a 600-row archive: one full fetch is required.
    bridge.state.rows = rows(600);
    hydrateHistory(rows(400), 600);

    expect(await history.all()).toHaveLength(600);
    expect(bridge.state.allCalls).toBe(1);

    await history.retag("n-1", { kind: "idiom" });
    await history.all();
    await history.retag("n-2", { domain: "services" });
    await history.all();

    expect(bridge.state.allCalls).toBe(1);
  });

  it("does not refetch after an exact re-translation once the full archive is known", async () => {
    const { history, hydrateHistory } = await import("./history");
    bridge.state.rows = rows(600);
    hydrateHistory(rows(400), 600);
    await history.all();

    await history.add({ source: "de", target: "ar", original: "Neu", translated: "جديد" });
    await history.all();

    expect(bridge.state.allCalls).toBe(1);
    expect(history.list().some((row) => row.original === "Neu")).toBe(true);
  });

  it("refetches again after a new boot snapshot replaces the cache", async () => {
    const { history, hydrateHistory } = await import("./history");
    bridge.state.rows = rows(3);
    hydrateHistory(rows(3), 3);
    await history.all();
    expect(bridge.state.allCalls).toBe(0);

    bridge.state.rows = rows(5);
    hydrateHistory(rows(2), 5);
    expect(await history.all()).toHaveLength(5);
    expect(bridge.state.allCalls).toBe(1);
  });

  it("keeps a row saved while another save is still asking for candidates", async () => {
    const { history, hydrateHistory } = await import("./history");
    hydrateHistory([], 0);
    bridge.state.deferCandidates = true;

    const first = history.add({ source: "de", target: "ar", original: "Alpha", translated: "أ" });
    const second = history.add({ source: "de", target: "ar", original: "Beta", translated: "ب" });
    expect(bridge.state.candidates).toHaveLength(2);

    bridge.state.candidates[0]!.resolve([]);
    await flush();
    bridge.state.candidates[1]!.resolve([]);
    await flush();
    await Promise.all([first, second]);

    const originals = history.list().map((row) => row.original);
    expect(originals).toContain("Alpha");
    expect(originals).toContain("Beta");
    expect(history.list()).toHaveLength(2);
  });
});

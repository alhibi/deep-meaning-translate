import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { history } from "./history";

const KEY = "lingua.history.v1";
/** Padded so no text is a prefix of another: prefix merging is a feature we test separately. */
const entry = (n: number, target = "ar") => ({
  source: "de",
  target,
  original: `Satz ${String(n).padStart(3, "0")}`,
  // Fixed width too: the quota test depends on every row serializing to the same size.
  translated: `جملة ${String(n).padStart(3, "0")}`,
});

beforeEach(() => {
  localStorage.clear();
  history.reload();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  history.reload();
});

describe("history archive", () => {
  it("stores a settled translation once and updates it in place", async () => {
    await history.add(entry(1));
    await history.add(entry(1));
    expect(history.list()).toHaveLength(1);
    expect(history.list()[0]?.translated).toBe("جملة 001");
    expect(history.lastWriteOk()).toBe(true);
  });

  it("merges a sentence that grew while typing instead of keeping both versions", async () => {
    await history.add({ source: "de", target: "ar", original: "Ich", translated: "أنا" });
    await history.add({
      source: "de",
      target: "ar",
      original: "Ich komme",
      translated: "أنا قادم",
    });
    expect(history.list()).toHaveLength(1);
    expect(history.list()[0]?.translated).toBe("أنا قادم");
  });

  it("counts a separate occasion as a use but never a second row", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    await history.add(entry(1));
    vi.spyOn(Date, "now").mockReturnValue(now + 60 * 60_000); // an hour later
    await history.add(entry(1));
    expect(history.list()).toHaveLength(1);
    expect(history.list()[0]?.uses).toBe(2);
    // The first date is the row's identity: it never moves forward.
    expect(history.list()[0]?.createdAt).toBe(now);
    expect(history.count()).toBe(1);
  });

  it("sheds the oldest rows when the device quota is reached, keeping the newest", async () => {
    await history.add(entry(1));
    // The exact size of one row: the quota below will fit one row and refuse two.
    const oneRow = localStorage.getItem(KEY)?.length ?? 0;
    expect(oneRow).toBeGreaterThan(100);
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === KEY && String(value).length > oneRow) {
        throw new DOMException("QuotaExceededError");
      }
      return real.call(this, key, value);
    });
    for (let n = 2; n <= 40; n++) await history.add(entry(n));
    const list = history.list();
    expect(history.lastWriteOk()).toBe(true);
    expect(history.lastEvicted()).toBe(1);
    expect(list).toHaveLength(1); // exactly what the quota can hold
    expect(list[0]?.original).toBe("Satz 040"); // the newest thought survives
    // What the list says is exactly what the device holds.
    expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toHaveLength(1);
  });

  it("never pretends a write happened when the device refuses all of it", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage) {
      void this;
      throw new DOMException("QuotaExceededError");
    });
    await history.add(entry(1));
    expect(history.lastWriteOk()).toBe(false);
    // The row is still shown for this session rather than silently vanishing.
    expect(history.list()).toHaveLength(1);
  });

  it("drops damaged, foreign and duplicate rows on read", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: "broken" },
        {
          id: "good",
          source: "de",
          target: "ar",
          original: "Hallo",
          translated: "مرحباً",
          createdAt: 1,
        },
        {
          id: "good",
          source: "de",
          target: "ar",
          original: "Hallo",
          translated: "نسخة مكررة",
          createdAt: 2,
        },
        {
          id: "foreign",
          source: "de",
          target: "ar",
          original: "Hallo",
          translated: "مرحباً",
          createdAt: "yesterday",
        },
      ]),
    );
    history.reload();
    expect(history.list()).toHaveLength(1);
    expect(history.list()[0]?.translated).toBe("مرحباً");
  });

  it("never archives an unfinished translation or an invalid target", async () => {
    await history.add({ source: "de", target: "ar", original: "Hallo", translated: "   " });
    await history.add({
      source: "de",
      target: "arabisch",
      original: "Hallo",
      translated: "مرحباً",
    });
    expect(history.list()).toHaveLength(0);
  });

  it("keeps the old day statistics when a row is corrected, not the corrected classification", async () => {
    await history.add(entry(1));
    const id = history.list()[0]!.id;
    await history.retag(id, { kind: "idiom" });
    const list = history.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.fix?.kind).toBe("idiom");
    expect(list[0]?.translated).toBe("جملة 001");
  });
});

import type {
  CultureCategory,
  CultureContinent,
  CultureLocale,
  CultureMedia,
  CulturePlace,
  LocalizedText,
} from "@/lib/culture/types";
import { CULTURE_IMAGE_HOSTS } from "@/lib/culture/media";
import type {
  CultureDetailItem,
  CultureDiscoveryAdapter,
  CultureFacets,
  CultureListEntry,
  CultureListPage,
  CulturePageQuery,
  CultureSavedPort,
} from "./contract";

/**
 * Test fixtures for the discovery UI. They are deliberately plain data: the UI tests need
 * real shaped records, not a second implementation of the corpus. No product code imports
 * this module.
 */

export function localizedText(en: string, ar: string, de: string): LocalizedText {
  return { en, ar, de };
}

export function makePlace(overrides: Partial<CulturePlace> = {}): CulturePlace {
  return { continent: "africa", countries: ["MA"], ...overrides };
}

/** An https image host that the runtime allowlist actually permits. */
export const ALLOWED_IMAGE_HOST = CULTURE_IMAGE_HOSTS[0] ?? "images.metmuseum.org";

export function makeMedia(overrides: Partial<CultureMedia> = {}): CultureMedia {
  return {
    url: "https://" + ALLOWED_IMAGE_HOST + "/img/full.jpg",
    thumbnailUrl: "https://" + ALLOWED_IMAGE_HOST + "/img/thumb.jpg",
    credit: "The Example Museum",
    license: "CC0-1.0",
    width: 1200,
    height: 800,
    ...overrides,
  };
}

export function makeEntry(
  overrides: Partial<CultureListEntry> & { id: string; category?: CultureCategory },
): CultureListEntry {
  const id = overrides.id;
  const category = overrides.category ?? "objects";
  const base: CultureListEntry = {
    id,
    title: localizedText("Title " + id, "عنوان " + id, "Titel " + id),
    category,
    continent: "africa",
    countries: ["MA"],
    tags: [],
    weight: 0.5,
    hasMedia: false,
  };
  const merged: CultureListEntry = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

export function makeItem(
  overrides: Partial<CultureDetailItem> & { id: string },
): CultureDetailItem {
  const id = overrides.id;
  const base: CultureDetailItem = {
    id,
    version: 1,
    title: localizedText("Full title " + id, "العنوان الكامل " + id, "Voller Titel " + id),
    summary: localizedText("A summary of " + id, "ملخص " + id, "Eine Zusammenfassung von " + id),
    taxonomy: { category: "objects" },
    place: makePlace(),
    tags: [],
    source: {
      organization: "The Example Museum",
      url: "https://example.org/record/" + id,
      license: "CC0-1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      attribution: "The Example Museum, CC0 1.0",
      modified: "2026-01-15",
    },
    provenance: "institution",
    ingestedAt: "2026-02-01",
  };
  return { ...base, ...overrides };
}

export function makeFacets(
  categories: CultureCategory[] = ["objects", "music"],
  continents: CultureContinent[] = ["africa", "asia"],
  countries: string[] = ["MA", "JP"],
): CultureFacets {
  return {
    categories: categories.map((value, index) => ({ value, count: categories.length - index })),
    continents: continents.map((value) => ({ value, count: 1 })),
    countries: countries.map((value) => ({ value, count: 1 })),
  };
}

export function makePage(
  items: CultureListEntry[],
  nextCursor?: string,
  total?: number,
): CultureListPage {
  const page: CultureListPage = { items };
  if (nextCursor !== undefined) page.nextCursor = nextCursor;
  if (total !== undefined) page.total = total;
  return page;
}

export interface SavedState {
  ids: string[];
  entries: CultureListEntry[];
}

export interface FakeAdapter extends CultureDiscoveryAdapter {
  calls: {
    pages: CulturePageQuery[];
    items: string[];
    related: { itemId: string; declared: readonly string[] }[];
    facets: number;
    featured: number;
    savedToggles: string[];
  };
  /** Set to make the next/current page reads fail. */
  setPageError(kind: "offline" | "failed" | null): void;
  setItemError(failed: boolean): void;
  setSaved(state: SavedState): void;
  savedState(): SavedState;
  setOnline(value: boolean): void;
}

export interface FakeAdapterOptions {
  pages?: CultureListPage[];
  items?: Record<string, CultureDetailItem>;
  related?: CultureListEntry[];
  featured?: CultureListEntry | null;
  facets?: CultureFacets | null;
  saved?: SavedState;
  online?: boolean;
  pageError?: "offline" | "failed" | null;
  itemError?: boolean;
}

/**
 * A recording adapter: every method is observable, page reads follow a fixed queue, and
 * failures are switchable so retry/offline journeys can be exercised deterministically.
 */
export function makeAdapter(options: FakeAdapterOptions = {}): FakeAdapter {
  const calls: FakeAdapter["calls"] = {
    pages: [],
    items: [],
    related: [],
    facets: 0,
    featured: 0,
    savedToggles: [],
  };
  const pages = [...(options.pages ?? [])];
  const items = { ...(options.items ?? {}) };
  const related = options.related ?? [];
  const facets = options.facets === undefined ? makeFacets() : options.facets;
  const featured = options.featured === undefined ? null : options.featured;
  let pageError: "offline" | "failed" | null = options.pageError ?? null;
  let itemError = options.itemError ?? false;
  let online = options.online ?? true;
  let saved: SavedState = options.saved ?? { ids: [], entries: [] };
  const listeners = new Set<() => void>();

  const savedPort: CultureSavedPort = {
    // A fresh array per call (the UI must cope with that: its snapshot cache keeps identity
    // stable only while the content is equal).
    ids: () => [...saved.ids],
    entries: () => saved.entries,
    toggle: (id) => {
      calls.savedToggles.push(id);
      const has = saved.ids.includes(id);
      const nextIds = has ? saved.ids.filter((value) => value !== id) : [...saved.ids, id];
      saved = {
        ids: nextIds,
        entries: saved.entries.filter((entry) => nextIds.includes(entry.id)),
      };
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const adapter: FakeAdapter = {
    calls,
    loadPage: async (query: CulturePageQuery) => {
      calls.pages.push(query);
      if (pageError) {
        throw new Error(pageError === "offline" ? "offline" : "failed");
      }
      const page = pages.shift();
      return page ?? { items: [] };
    },
    loadFacets: async () => {
      calls.facets += 1;
      if (!facets) throw new Error("no facets");
      return facets;
    },
    loadFeatured: async () => {
      calls.featured += 1;
      return featured;
    },
    loadItem: async (id: string) => {
      calls.items.push(id);
      if (itemError) throw new Error("item failed");
      return items[id] ?? null;
    },
    loadRelated: async (itemId: string, declared: readonly string[]) => {
      calls.related.push({ itemId, declared });
      return related;
    },
    saved: savedPort,
    online: () => online,
    setPageError: (kind) => {
      pageError = kind;
    },
    setItemError: (failed) => {
      itemError = failed;
    },
    setSaved: (state) => {
      saved = state;
      for (const listener of listeners) listener();
    },
    savedState: () => saved,
    setOnline: (value) => {
      online = value;
    },
  };
  return adapter;
}

/** A record rich enough for every block of the reading surface. */
export function richItem(id = "relic"): CultureDetailItem {
  return makeItem({
    id,
    title: {
      en: "The Cedar Chest",
      ar: "صندوق الأرز",
      de: "Die Zedernholztruhe",
      original: "صندوق الأرز",
      originalLanguage: "ar",
    },
    summary: {
      en: "A painted chest from the Atlas Mountains.",
      ar: "صندوق مزيّن من جبال الأطلس.",
      de: "Eine bemalte Truhe aus dem Atlasgebirge.",
    },
    description: {
      en: "Cedar panels joined without nails and painted with henna.",
      ar: "ألواح أرز موصولة بلا مسامير ومزيّنة بالحنّاء.",
      de: "Zedernbretter ohne Nägel gefügt und mit Henna bemalt.",
    },
    taxonomy: { category: "objects" },
    place: { continent: "africa", countries: ["MA"], region: "Atlas Mountains" },
    period: "19th century",
    subject: "Chest",
    tags: ["cedar", "henna"],
    media: makeMedia({ credit: "The Example Museum" }),
    provenance: "institution",
    related: ["related-1"],
    whyDistinctive: {
      en: "The joinery needs no nails, so the chest can be taken apart and rebuilt.",
      ar: "الوصل لا يحتاج مسامير، فيمكن تفكيك الصندوق وإعادة بنائه.",
      de: "Die Fügung braucht keine Nägel, die Truhe lässt sich zerlegen und neu bauen.",
    },
  });
}

/** A record whose summary is our own AI-assisted text, not institutional wording. */
export function machineItem(id = "machine"): CultureDetailItem {
  return makeItem({
    id,
    provenance: "machine-translated",
    summary: {
      en: "A short paraphrase of the source text.",
      ar: "إعادة صياغة قصيرة لنص المصدر.",
      de: "Eine kurze Paraphrase des Quelltextes.",
    },
    title: {
      en: "Hurma",
      ar: "حُرمة",
      de: "Hurma",
      original: "حُرمة",
      originalLanguage: "ar",
    },
  });
}

export const LOCALES: CultureLocale[] = ["ar", "de", "en"];

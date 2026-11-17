import { vi, type Mock } from "vitest";
import type {
  CultureDiscoveryAdapter,
  CultureFacets,
  CultureListPage,
  CulturePageQuery,
} from "@/lib/culture/adapter";
import type {
  CultureArticle,
  CultureCategory,
  CultureContentType,
  CultureIndexEntry,
  LocalizedText,
} from "@/lib/culture/types";

/** Shared, explicit fixtures: no test invents data inside a component, it passes it in. */
export function text(en: string, de = en, ar = en): LocalizedText {
  return { en, de, ar };
}

export function makeEntry(
  overrides: Partial<CultureIndexEntry> & { id: string },
): CultureIndexEntry {
  const id = overrides.id;
  return {
    title: text("A quiet habit", "Eine stille Gewohnheit", "عادة هادئة"),
    teaser: text(
      "A short written discovery about the way a thing is actually done.",
      "Eine kurze geschriebene Entdeckung darüber, wie eine Sache tatsächlich getan wird.",
      "اكتشاف مكتوب قصير عن الطريقة التي يُفعل بها الشيء فعلاً.",
    ),
    category: "everyday-life",
    contentType: "note",
    continent: "europe",
    countries: ["DE"],
    tags: ["greeting"],
    readingMinutes: 4,
    weight: 0.4,
    hasExpression: false,
    ...overrides,
    id,
  };
}

const SECTIONS = {
  en: [
    {
      heading: "What happens",
      paragraphs: [
        "The first paragraph of the piece, written as a complete thought rather than a blurb.",
      ],
    },
  ],
  de: [
    {
      heading: "Was geschieht",
      paragraphs: ["Der erste Absatz des Beitrags, als vollständiger Gedanke geschrieben."],
    },
  ],
  ar: [
    {
      heading: "ما يحدث",
      paragraphs: ["الفقرة الأولى من النص، مكتوبة كفكرة كاملة لا كسطر إعلاني."],
    },
  ],
};

export function makeArticle(overrides: Partial<CultureArticle> & { id: string }): CultureArticle {
  const id = overrides.id;
  return {
    version: 2,
    slug: id,
    contentType: "feature",
    category: "everyday-life",
    title: text("A quiet habit", "Eine stille Gewohnheit", "عادة هادئة"),
    deck: text(
      "How a small daily act carries a whole way of being together.",
      "Wie eine kleine tägliche Handlung eine ganze Art des Miteinanders trägt.",
      "كيف يحمل فعل يومي صغير طريقة كاملة في الاجتماع.",
    ),
    teaser: text(
      "A short written discovery about the way a thing is actually done.",
      "Eine kurze geschriebene Entdeckung darüber, wie eine Sache tatsächlich getan wird.",
      "اكتشاف مكتوب قصير عن الطريقة التي يُفعل بها الشيء فعلاً.",
    ),
    readingMinutes: 5,
    sections: SECTIONS,
    example: text(
      "Say it when you arrive, not when you leave.",
      "Sag es, wenn du ankommst, nicht wenn du gehst.",
      "قُلها حين تصل، لا حين تنصرف.",
    ),
    misunderstanding: text(
      "It is not politeness for its own sake; it marks that the visit has begun.",
      "Es ist keine Höflichkeit um ihrer selbst willen; es markiert den Beginn des Besuchs.",
      "ليست مجاملة لذاتها؛ إنها تؤشّر إلى أن الزيارة بدأت.",
    ),
    comparison: text(
      "In one city it is said at the door; in another, only after the tea.",
      "In einer Stadt sagt man es an der Tür, in einer anderen erst nach dem Tee.",
      "في مدينة تُقال عند الباب، وفي أخرى بعد الشاي فقط.",
    ),
    context: {
      countries: ["DE", "AT"],
      region: "Central Europe",
      continent: "europe",
      languages: ["de"],
      period: "contemporary",
    },
    tags: ["greeting", "visiting"],
    sources: [
      {
        organization: "Example Ethnographic Institute",
        title: text(
          "Everyday greetings in the German-speaking world",
          "Alltägliche Begrüßungen im deutschsprachigen Raum",
          "التحيات اليومية في العالم الناطق بالألمانية",
        ),
        url: "https://example.org/greetings",
        accessed: "2026-11-01",
        supports: text(
          "Describes the greeting at the door.",
          "Beschreibt die Begrüßung an der Tür.",
          "يصف التحية عند الباب.",
        ),
      },
    ],
    status: {
      verification: "source-linked",
      editorial: "editor-reviewed",
      translation: "machine-drafted",
      revision: 1,
      published: true,
    },
    related: [],
    publishedAt: "2026-11-01",
    ...overrides,
    id,
  };
}

export const ENTRY_TYPES: readonly CultureContentType[] = [
  "feature",
  "note",
  "language",
  "scene",
  "contrast",
  "detail",
];

const TYPE_TITLES: Record<CultureContentType, string> = {
  feature: "A feature on greetings",
  note: "A note on greetings",
  language: "The word for welcome",
  scene: "A scene at the door",
  contrast: "Two ways to arrive",
  detail: "The plate that stays",
};

export function makeTypedEntries(): CultureIndexEntry[] {
  return ENTRY_TYPES.map((contentType) =>
    makeEntry({ id: "entry-" + contentType, contentType, title: text(TYPE_TITLES[contentType]) }),
  );
}

export const DEFAULT_FACETS: CultureFacets = {
  categories: [
    { value: "everyday-life" as CultureCategory, count: 3 },
    { value: "languages" as CultureCategory, count: 1 },
  ],
  continents: [
    { value: "europe", count: 4 },
    { value: "asia", count: 1 },
  ],
  countries: [
    { value: "DE", count: 3 },
    { value: "AT", count: 1 },
    { value: "MA", count: 1 },
  ],
  types: [
    { value: "feature", count: 1 },
    { value: "note", count: 1 },
    { value: "language", count: 1 },
  ],
};

export interface FakeAdapterOverrides {
  loadPage?: (query: CulturePageQuery, signal?: AbortSignal) => Promise<CultureListPage>;
  loadFacets?: () => Promise<CultureFacets>;
  loadFeatured?: () => Promise<CultureIndexEntry | null>;
  loadItem?: (id: string) => Promise<CultureArticle | null>;
  loadRelated?: (ids: readonly string[]) => Promise<CultureIndexEntry[]>;
  online?: boolean;
  entries?: readonly CultureIndexEntry[];
  savedIds?: readonly string[];
}

export interface FakeAdapter {
  adapter: CultureDiscoveryAdapter;
  loadPage: Mock;
  loadFacets: Mock;
  loadFeatured: Mock;
  loadItem: Mock;
  loadRelated: Mock;
  savedToggle: Mock;
  setSaved(ids: readonly string[]): void;
  setOnline(value: boolean): void;
}

export function createFakeAdapter(overrides: FakeAdapterOverrides = {}): FakeAdapter {
  const entries = overrides.entries ?? makeTypedEntries();
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let online = overrides.online ?? true;
  let savedIdList: string[] = [...(overrides.savedIds ?? [])];
  let savedEntryList: CultureIndexEntry[] = savedIdList
    .map((id) => byId.get(id))
    .filter((entry): entry is CultureIndexEntry => Boolean(entry));
  const listeners = new Set<() => void>();

  const loadPage = vi.fn(
    overrides.loadPage ??
      (async () => ({ items: [...entries], total: entries.length }) as CultureListPage),
  );
  const loadFacets = vi.fn(overrides.loadFacets ?? (async () => DEFAULT_FACETS));
  const loadFeatured = vi.fn(
    overrides.loadFeatured ??
      (async () => entries.find((entry) => entry.contentType === "feature") ?? null),
  );
  const loadItem = vi.fn(overrides.loadItem ?? (async () => null));
  const loadRelated = vi.fn(overrides.loadRelated ?? (async () => []));
  const savedToggle = vi.fn((id: string) => {
    savedIdList = savedIdList.includes(id)
      ? savedIdList.filter((value) => value !== id)
      : [...savedIdList, id];
    savedEntryList = savedIdList
      .map((savedId) => byId.get(savedId))
      .filter((entry): entry is CultureIndexEntry => Boolean(entry));
    for (const listener of listeners) listener();
  });

  const adapter: CultureDiscoveryAdapter = {
    loadPage,
    loadFacets,
    loadFeatured,
    loadItem,
    loadRelated,
    saved: {
      ids: () => savedIdList,
      entries: () => savedEntryList,
      toggle: savedToggle,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    online: () => online,
  };

  return {
    adapter,
    loadPage,
    loadFacets,
    loadFeatured,
    loadItem,
    loadRelated,
    savedToggle,
    setSaved(ids: readonly string[]) {
      savedIdList = [...ids];
      savedEntryList = savedIdList
        .map((id) => byId.get(id))
        .filter((entry): entry is CultureIndexEntry => Boolean(entry));
      for (const listener of listeners) listener();
    },
    setOnline(value: boolean) {
      online = value;
    },
  };
}

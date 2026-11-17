import { describe, expect, it } from "vitest";
import {
  AUTO_PAGE_LIMIT,
  COPY,
  CultureDiscovery,
  DEFAULT_PAGE_SIZE,
  MORE_COOLDOWN_MS,
  SEARCH_DEBOUNCE_MS,
  createCultureDiscoveryAdapter,
  cultureCopy,
} from "./index";

/** The public surface the translator route imports: one section and one adapter factory. */
describe("section public surface", () => {
  it("exports the section, the production adapter factory and its constants", () => {
    expect(typeof CultureDiscovery).toBe("function");
    expect(typeof createCultureDiscoveryAdapter).toBe("function");
    expect(cultureCopy("en")).toBe(COPY.en);
    expect(DEFAULT_PAGE_SIZE).toBe(8);
    expect(AUTO_PAGE_LIMIT).toBe(2);
    expect(MORE_COOLDOWN_MS).toBeGreaterThan(0);
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThan(0);
  });

  it("builds an adapter with every method the section calls", () => {
    const adapter = createCultureDiscoveryAdapter({ dayKey: () => "2026-11-17" });
    expect(typeof adapter.loadPage).toBe("function");
    expect(typeof adapter.loadFacets).toBe("function");
    expect(typeof adapter.loadFeatured).toBe("function");
    expect(typeof adapter.loadItem).toBe("function");
    expect(typeof adapter.loadRelated).toBe("function");
    expect(typeof adapter.saved.ids).toBe("function");
    expect(typeof adapter.saved.entries).toBe("function");
    expect(typeof adapter.saved.toggle).toBe("function");
    expect(typeof adapter.saved.subscribe).toBe("function");
  });
});

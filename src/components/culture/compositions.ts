import type { CultureCategory } from "@/lib/culture/types";

/**
 * List-card compositions. Every record renders through the same card, but the editorial
 * shape follows what the record *is*: an object carries its image, a practice is carried by
 * its words, a place by its landscape. The mapping is closed over the shared category list,
 * so a new corpus category cannot silently fall into an undefined layout.
 */
export type CultureComposition =
  "artifact" | "place" | "practice" | "word" | "material" | "food" | "quiet";

const COMPOSITION_BY_CATEGORY: Record<CultureCategory, CultureComposition> = {
  traditions: "practice",
  architecture: "place",
  "indigenous-knowledge": "practice",
  crafts: "material",
  textiles: "material",
  "food-culture": "food",
  ingredients: "food",
  music: "practice",
  dance: "practice",
  festivals: "practice",
  storytelling: "practice",
  language: "word",
  untranslatable: "word",
  games: "practice",
  tools: "artifact",
  astronomy: "practice",
  agriculture: "material",
  trade: "material",
  landscapes: "place",
  "medicine-knowledge": "practice",
  "ritual-objects": "artifact",
  "endangered-crafts": "material",
  design: "material",
  "everyday-life": "quiet",
  objects: "artifact",
};

export function compositionFor(category: CultureCategory): CultureComposition {
  return COMPOSITION_BY_CATEGORY[category] ?? "quiet";
}

/** Compositions that use the full row in the two-column feed. */
const WIDE: ReadonlySet<CultureComposition> = new Set(["artifact", "place"]);

export function isWideComposition(composition: CultureComposition): boolean {
  return WIDE.has(composition);
}

/** Compositions that ask for an image at all; the others stay typographic by design. */
const IMAGE_LED: ReadonlySet<CultureComposition> = new Set([
  "artifact",
  "place",
  "material",
  "food",
]);

export function wantsMedia(composition: CultureComposition): boolean {
  return IMAGE_LED.has(composition);
}

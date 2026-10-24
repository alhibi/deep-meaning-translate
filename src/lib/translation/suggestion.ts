import type { StyleOverride } from "./types";

export interface StyleSuggestion {
  /** Translation key for the quiet prompt, e.g. "sit_work". */
  key: "sit_official" | "sit_work" | "sit_chat";
  next: StyleOverride;
}

/**
 * One quiet style suggestion, only when the model's reading of the situation
 * disagrees with the style the writer chose. Rules, in order:
 *
 * - official/work text written in natural or casual → offer formal
 * - personal/chat text written in formal → offer casual
 * - everything else → nothing at all
 *
 * A suggestion is never repeated for the same text and style (the caller remembers
 * the dismissal), and it is never shown while the translation is still moving.
 */
export function styleSuggestion(opts: {
  situation: string | undefined;
  style: StyleOverride;
}): StyleSuggestion | null {
  const { situation, style } = opts;
  if (!situation) return null;
  if ((situation === "official" || situation === "work") && style !== "formal")
    return { key: situation === "official" ? "sit_official" : "sit_work", next: "formal" };
  if (situation === "chat" && style === "formal") return { key: "sit_chat", next: "casual" };
  return null;
}

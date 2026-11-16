/**
 * Which moment the translator canvas is in.
 *
 * One decision read by the layout's height contract: how much of the screen the writing
 * surface keeps, how much the result is promised, and how quickly the seam between them
 * settles. Keeping it here — rather than three conditionals in the route — means the
 * geometry can be reasoned about and tested without a DOM.
 */
export type CanvasStage = "idle" | "writing" | "translating" | "settled";

export function canvasStage(args: {
  /** Anything written, including a draft not sent yet. */
  hasText: boolean;
  /** A settled translation is on screen (an older one counts while a new one is typed). */
  hasResult: boolean;
  /** A request is producing text right now: scheduled, streaming or re-routing. */
  live: boolean;
}): CanvasStage {
  // A live request outranks an older answer: the result is about to be replaced, so it
  // must already own the room the settled translation will need.
  if (args.live) return "translating";
  if (args.hasResult) return "settled";
  return args.hasText ? "writing" : "idle";
}

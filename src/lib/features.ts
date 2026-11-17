/**
 * Product-surface switches.
 *
 * Weather and the cultural library are built, tested and still routed, but they are not
 * part of the translator in this release. Hiding is a switch, not a deletion: their
 * components, hooks, routes, corpus, styles and tests stay in the tree, and flipping a
 * switch restores the below-the-canvas composition in `BelowCanvas` with no new code.
 *
 * Keep the product, architecture and privacy documents in step with these values; a
 * surface that is off here must not be advertised as available in /about.
 */
export const SHOW_WEATHER = false;
export const SHOW_CULTURE = false;

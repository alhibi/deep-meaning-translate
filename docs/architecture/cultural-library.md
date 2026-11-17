# Cultural knowledge library

Status: **Phase II correction, 2026-11-17**. Scope: how written cultural knowledge is modelled,
produced, validated, stored and displayed below the translator.

**Release visibility (2026-11-17):** the translator does not compose this section in the current
release (`SHOW_CULTURE = false` in `src/lib/features.ts`). The module, corpus, routes, stores and
tests remain; this document describes the built module, not its current placement.

## Product

The library is **Cultures, people and everyday life across the world** (Arabic identity:
نافذة على العالم). It is a text-first, editorial knowledge experience: how people live, greet,
refuse, eat, celebrate, work, speak and understand each other. It is not a museum catalogue, an art
gallery, a travel directory or a news feed. There are no imported photographs, no hotlinked images
and no media field; the article is the product and the interface is built from typography, spacing,
rules and composition variety.

## Ontology (src/lib/culture/types.ts, schema v2)

CultureArticle is the primary entity: id, version, slug, contentType (feature, note, language,
scene, contrast, detail), one primary category from a broad eighteen-category editorial taxonomy,
localized title, deck, teaser, structured sections (heading + paragraphs per locale), optional
expression (real script, transliteration, language, gloss, usage), optional example,
misunderstanding and comparison, geographic/community context (ISO countries, region, community,
continent, languages, period), tags, sources, status (verification, editorial review, translation
review, revision, published), related ids and publication date. Optional blocks stay absent when the
source does not support them — nothing is invented to fill a template.

The compact CultureIndexEntry (title, teaser, category, type, continent, countries, tags, reading
time, weight, hasExpression) is the only thing loaded for browsing; full bodies live in lazy chunks.

## Pipeline (scripts/culture)

1. **Research seeds** — specialist research batches write data/culture/seeds/<area>.json: a unique
   specific title, 4–6 documented facts, a concrete example, a qualification about variation, two
   verified public reference URLs, and a real expression for language/communication topics.
2. **Generation** (node scripts/culture/pipeline.mjs generate) — a build-time model call writes the
   English, German and Arabic article from those facts only, in JSON, cached per topic so re-runs
   are cheap. No runtime model call ever produces or alters library content.
3. **Validation** (validate) — fails on missing localized titles/teasers/sections, too-short or
   oversized bodies, placeholders, museum-object vocabulary, missing or non-https sources,
   non-ISO countries, duplicate titles, or less than 500 valid articles / 60 countries / six
   continents / 15 categories / 100 long-form articles.
4. **Build** (build) — writes src/lib/culture/data/index.ts plus chunk-N.ts modules (50 articles
   each) and data/culture/report.json (distribution, locale coverage, extended count, duplicates).

## Sourcing and integrity

Every article records two public references with organization, title (in all three interface
languages), URL, access date and what the source supports. Verification status is source-linked;
editorial status is machine-drafted (the first build has no human editorial pass — this is stated in
the record and in the audit, not hidden). Aggregated references are general public knowledge pages
(Wikipedia and occasional institutional pages) checked for HTTP 200 at research time; the
generation prompt forbids introducing facts beyond the supplied research notes. Arabic and German
are generated editorially rather than translated line by line, but they remain machine-drafted
until reviewed.

## Display (src/components/culture)

A section below the weather: small editorial label, introduction, daily featured article, a mixed
feed of six text-only compositions (feature, note, language window, everyday scene, cultural
contrast, thoughtful detail), search over localized titles/teasers/tags, filters by category,
continent, country and type, a saved shelf, "another discovery", and cursor-paged progressive
loading with in-flight guards and a page cap. Reading opens a real dialog: heading, deck, body
sections, expression, example, misunderstanding, comparison, context, restrained References area
(links open in a new tab only when chosen), reading time, save toggle and related articles. Focus is
trapped and returned, scroll position is restored, and the experience works offline because the
library is bundled and precached.

## Privacy and cost\n\nBrowsing the library sends nothing: no API call, no image request, no model request, no\nanalytics. Source links leave the app only when the reader chooses them. The corpus is generated at\nbuild time, so runtime cost per card is zero. Saved and seen lists remain device-only, validated,\nbounded and cleared by "forget everything".\n
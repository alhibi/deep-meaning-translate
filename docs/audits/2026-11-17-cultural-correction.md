# Phase II correction — the cultural library rebuilt as written knowledge (2026-11-17)

## Why this correction happened

The first Phase II delivery implemented cultural discovery as a museum-object catalogue (595
Metropolitan Museum CC0 records shaped around images and object metadata). That was the wrong
product: the requirement is a written cultural knowledge library about people, societies, language,
everyday life and traditions, where the content is the product and images are not. The catalogue
was removed — not relabelled, not re-imaged — and the feature was rebuilt at the level of its
ontology, editorial pipeline, data model, display and validation.

The weather module and the translator were not rebuilt; weather is untouched and keeps its provider
architecture, tests and UI.

## What the library is now

- **Text-first editorial knowledge**: three-language articles (Arabic, German, English) with a
  specific title, deck, teaser, structured sections, reading time, real expressions for language
  topics, examples, a variation qualification, optional misunderstanding/comparison, context,
  references and a truthful review status. No images, no media field, no catalogue objects.
- **A broad taxonomy** of eighteen categories: everyday life, social behaviour, languages,
  communication, traditions, family and friendship, food and hospitality, work and education, cities
  and community, music and dance, games and leisure, storytelling, clothing and design, nature and
  seasons, beliefs and folklore, migration and identity, regional humour, cultural change.
- **Build-time pipeline** (scripts/culture): research seeds with verified public references →
  model-assisted article generation (cached per topic) → strict structural/content validation →
  lazy TS index and article chunks → distribution report. Nothing is generated at runtime and no
  article depends on a network request or an image.
- **Six text-first compositions** in the UI (feature, note, language window, everyday scene,
  cultural contrast, detail) instead of cards with pictures; a reading dialog with focus and scroll
  restoration, saved articles, related reading, search, filters and cursor-paged progressive
  loading.
- **The museum dependency is gone from the product**: the Met corpus, ingestion scripts, media host
  registry, image CSP allowances and object vocabulary are removed; a new content gate
  (npm run check:security) fails the build if an image, media field or museum vocabulary returns.
- **Privacy is simpler and stronger**: browsing sends nothing at all (no external host, no model,
  no analytics); references open only when the reader chooses a link.

## Workforce (real execution contexts)

| Agent        | Scope                                                                 | Result                                            |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------------- |
| c-arab       | Arab world and North Africa research seeds                            | 70 topics, 140/140 source URLs verified HTTP 200  |
| c-africa     | Sub-Saharan Africa research seeds                                     | 60 topics, 120/120 verified                       |
| c-asia       | East/South/South-East/Central Asia research seeds                     | 80 topics, 160/160 verified                       |
| c-europe     | European societies and regional differences                           | 75 topics, 150/150 verified                       |
| c-americas   | Americas and Indigenous peoples                                       | 55 topics, 110/110 verified                       |
| c-oceania    | Oceania and Indigenous/Pacific communities                            | 35 topics, 70/70 verified                         |
| c-language   | Language and communication worldwide                                  | 90 topics, 180/180 verified, 43 non-Latin scripts |
| c-social     | Social behaviour and everyday life                                    | 85 topics, 170/170 verified                       |
| c-traditions | Traditions, customs and rituals                                       | 70 topics, 140/140 verified                       |
| c-work       | Work, education, cities, regional identity                            | 60 topics, 120/120 verified                       |
| e-engine     | New v2 article engine: loader, search, discovery, saved/seen, adapter | 101 tests                                         |
| u-ui         | Text-first UI: six compositions, reading view, filters, saved, states | 35 tests                                          |
| coordinator  | Ontology, pipeline, validation, integration, docs, gates, evidence    | this audit                                        |

Each specialist was a separate execution context with a disjoint file scope (seed batches by region
or domain; engine and UI owned their own modules). The coordinator rejected seeds without two
working references, deduplicated over 590 topics, capped long-form articles, and ran the corpus
validator. The content model is machine-drafted in this build: that is recorded per article and in
the limits below, not disguised as editorial review.

## Corpus (generated: data/culture/report.json)

- Published articles: **542** (all three locales complete).
- Countries: **163** · documented communities: **96** · languages referenced: **122**.
- Extended long-form articles: **126** · average body length: **173 words** · language/communication records with a real expression: **169**.
- Categories represented: **18** of 18.
- Per continent / per category distribution and every count: data/culture/report.json (generated from the corpus, not hand-written).

## Gates

| Gate                 | Command                                      | Result                                                                                                        |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Corpus validation    | node scripts/culture/pipeline.mjs validate   | PASS - 542 articles, 6 continents, 18 categories, 126 extended, locale coverage complete, no duplicate titles |
| Content gate         | node tests/security/culture-content-gate.mjs | PASS - text-first, image-free, no media field and no museum host/vocabulary in the shipped library            |
| Typecheck            | npx tsc --noEmit                             | PASS                                                                                                          |
| Unit/integration     | npx vitest run (full)                        | PASS - 135 files, 1304 tests passed, 4 skipped; coverage 69.80/62.28/63.93/73.24                              |
| Build + PWA          | npm run build && npm run check:pwa           | PASS; 70 precached files / 68 hashed assets, corpus chunks cached for offline reading                         |
| Browser visual check | Playwright at 390x844                        | 7 states captured under docs/audits/evidence/2026-11-17-cultural-correction/                                  |

The full repo gate (npm run verify) result is recorded in the final delivery message and in docs/quality/testing.md.

## Honest limits (NOT_VERIFIED)

- **No human editorial or fact-check pass yet.** Articles are machine-drafted from curated facts and
  aggregated public references (mostly Wikipedia pages, verified HTTP 200 at research time). The
  validator enforces structure, sourcing, locale coverage, length, placeholders and museum-content
  absence, but it cannot prove a subtle claim. Article status says machine-drafted; a human sample
  review is the next required step.
- Sources are general public knowledge pages rather than field studies for most topics; the
  research layer records what each source supports, but claim-level citation granularity is coarse.
- Arabic and German are generated with an editorial instruction (not line-by-line translation) and
  read naturally in the sampled articles, but a native-editor pass is not done.
- Coverage is balanced by design but not uniform: some small states/communities are represented
  through a single topic; transnational communities are recorded with an empty country list by
  design.
- Android visual evidence for the corrected library is not captured; screenshots in the audit are
  web (Chromium, 390x844).

## Independent sample review (real agent, r-review)

A separate review agent sampled 12 of the 542 articles across all six continents and read all three
locales, with no access to the writer context. It checked cultural sensitivity, three-language
quality, source plausibility (6 source URLs fetched, 6 x HTTP 200), index/chunk consistency
(542/542), the content gate and placeholders.

- Result: **no stereotypes, exoticising, museum/image leakage or placeholder text**; hedging was
  judged careful; index and chunks consistent.
- **2 high issues found and fixed before commit**: eur-035 German contained corrupted non-words
  ("todsternen"/"todstorne" -> "todernste") and a clipped title; eur-069 Arabic named the Romani
  language "الرومانية" (Romanian) and asserted it was Indo-Aryan - corrected to "الرومنية".
- 13 medium and 10 low issues were reported (untranslated tokens in Arabic/German, calques, one
  locale-drift detail). The tractable ones (afr-004, afr-027 x2, arb-044, asa-066, ame-002) were
  corrected in the same pass; the remaining wording issues and the need for a full native-editor
  pass are recorded as TD51, not hidden.
- Limits: 12/542 is a sample, not a full review; the reviewer is also a model, so this is a
  second-pass check, not human editorial certification.

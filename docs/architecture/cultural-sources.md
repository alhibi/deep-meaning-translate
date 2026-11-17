# Cultural sources, rights and licensing

Status: **Research complete (2026-11-17)** — every claim below is backed by a live probe or a
current official document fetched from this environment on 2026-11-17 (Europe/Berlin); raw
evidence is in `artifacts/phase2/task-13.md` (gitignored). This document is decision input for
the Phase II cultural corpus. It changes no product code. **It is not legal advice**: the
commercial-posture and share-alike questions in §10 need a lawyer before launch.

Audience: whoever ingests the corpus (A09/A10/A11), the security gate owner (A15), and the lead
who integrates and indexes this document.

## 1. Scope and the question this answers

The Phase II catalogue needs **500 display-ready records**, each with **Arabic, German and
English core metadata**, across six content domains: traditions, food, music, crafts,
architecture and language. `src/lib/culture/types.ts` is the display contract: a record without
all three locales is dropped by the loader, and every record must carry
`source { organization, url, license, attribution }` plus a `provenance` class.

The question is not "can we find 500 facts" — museum and aggregator APIs return hundreds of
thousands. The question is **what may be stored, translated, displayed and redistributed** in a
distributed web/Android app, and **which sources can yield display-ready records inside those
rights**. Two constraints dominate:

1. The app is distributed (web bundle + APK) and offline-first, so any media shipped with it is
   redistribution, not a link. Remote media is limited by the app's CSP image allowlist.
2. "Display-ready" means three reviewed language versions, not an API row. Licensing sets the
   ceiling; **editorial capacity is the real schedule risk**.

| Domain in brief | Maps to `CULTURE_CATEGORIES` |
| --- | --- |
| traditions | `traditions`, `festivals`, `storytelling`, `ritual-objects`, `dance` |
| food | `food-culture`, `ingredients` |
| music | `music` |
| crafts | `crafts`, `textiles`, `endangered-crafts`, `objects`, `tools`, `design` |
| architecture | `architecture`, `landscapes` |
| language | `language` |

## 2. Method and classification

- Access date for every URL and probe: **2026-11-17**. Terms and licences change; re-verify
  quarterly and before each corpus release (store the fetch date in the record, §6).
- Probes used `curl`/Python with a descriptive User-Agent and low volume (< 150 requests total
  across all hosts). No account, key or token was created; only public demo keys were used.
- Facts about a live endpoint are classified **PASS** (accepted response verified), **FAIL**
  (endpoint exists but blocked/refused/retired — the reason is recorded) or **NOT_VERIFIED**
  (could not be checked from this environment; must be re-checked before reliance).
- Counts are observed response fields at the date above. They are *supply* evidence, not a
  promise of display-ready quality; small PD-ratio samples are stated with sample size and are
  not extrapolated as if measured.

## 3. Rights matrix — sources at a glance

| Source | Metadata rights | Media rights | Key needed | Commercial use | Redistribution of metadata | Attribution required | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The Met (Open Access API) | CC0 (Open Access dataset) | Object-dependent: CC0 when `isPublicDomain=true`, else copyright (do not use image) | No | Yes for CC0 material | Yes (CC0) | Not legally required; expected as good practice | **USABLE** (filter PD per object) |
| Smithsonian Open Access API | CC0 for items marked `metadata_usage.access=CC0` | CC0 when marked; per-media field must be read from the full record | **Yes** (api.si.edu key; `DEMO_KEY` is test-only) | Yes for CC0-marked content | Yes (CC0) | Not legally required; expected | **USABLE** with key + per-media check |
| Europeana | CC0 for metadata | Per item: `rights` field; only CC0/PD/CC BY/CC BY-SA usable, never InC/unknown | **Yes** (production key; `api2demo` is for testing) | Only per the item's licence | Metadata yes (CC0, credit requested) | Yes: data provider + Europeana (requested) | **USABLE** with strict per-item filter |
| Wikimedia / Wikipedia / Commons | Wikipedia text CC BY-SA 4.0 (+GFDL); Wikidata CC0; Commons per file | Per file (CC0/PD/CC BY/CC BY-SA; NC/ND not hosted) | No | Yes (licences allow; attribution/share-alike apply) | Wikipedia text only with attribution + share-alike; Wikidata yes | **Yes** for CC BY/CC BY-SA (creator, licence, changes) | **USABLE** carefully (write own text; per-file media check) |
| UNESCO ICH | © UNESCO, all rights reserved; non-commercial quotation only | © credited photographers/institutions | No API exists | **No** for our purposes | **No** for text/media beyond quotation | Citation only | **METADATA-LINK ONLY** (do not ingest content) |
| Art Institute of Chicago (alternative) | CC0 except `description` field = CC BY 4.0 | CC0 only where labelled "CC0 Public Domain Designation"; other images require licensing | No | Yes for CC0/labelled material | Yes (metadata CC0) | Yes for CC BY descriptions/images | **USABLE** (metadata + CC0 media) |
| Rijksmuseum Data Services (additional) | Per object: mostly PD/CC0, some CC BY 4.0 | Per object: PD/CC0 or CC BY 4.0; restricted photos flagged | No | Yes where openly licensed | Yes | Yes ("acknowledge the Rijksmuseum as the source") | **USABLE** (per-object licence check) |
| Digital Public Library of America (additional) | Metadata CC0 per DPLA metadata policy (2026 status NOT_VERIFIED) | Provider-hosted; per-item rights | **Yes** (32-char key) | Per item | Metadata yes | Per item | **BACKUP ONLY** |
| Glottolog (language support) | CC BY 4.0 | n/a | No (bulk download) | Yes | Yes with attribution | **Yes** (citation: Glottolog 5.4, Hammarström et al.) | **USABLE** for language facts |

## 4. Source-by-source findings

### 4.1 The Metropolitan Museum of Art — Open Access API  **PASS**

- Official docs: <https://metmuseum.github.io/> (fetched 2026-11-17). The docs state: no API key
  or registration; **limit requests to 80 per second**; the API serves Open Access data and
  high-resolution JPEG images "that are in the public domain". `/public/collection/v1.1/search`
  is the current search (added 2026-09-04, paginated with `offset`/`limit`, default 100, max
  500). **`/public/collection/v1/search` was retired on 2026-10-01** and a live probe returned
  `410` — any code still calling v1 is broken.
- Open Access dataset: <https://github.com/metmuseum/openaccess> README (raw fetch,
  2026-11-17): information on **more than 470,000 artworks** is provided "for unrestricted
  commercial and noncommercial use" and waived under **CC0**; **images are not part of the
  dataset**; images are identified on the website with the CC0 icon; the image policy is on the
  Met site.
- Probed: `GET /objects/45734` → 200, `isPublicDomain: true`, `primaryImage` present,
  `rightsAndReproduction` empty; `HEAD` on the `images.metmuseum.org` JPEG → 200 image/jpeg
  (38,729 bytes). The Open Access CSV (`MetObjects.csv`) responds 206 with an advertised size of
  **341,062,985 bytes** (341 MB) — usable as a one-time bulk source, not a runtime dependency.
- Limitations found:
  - `isPublicDomain` is **not** a working search filter: adding it did not change the result
    total (709 for `q=coffee&hasImages=true`). Filter on each object's `isPublicDomain`
    field, or on the CSV's "Is Public Domain" column.
  - PD rates vary sharply by collection. Probes: Department 18 Musical Instruments **28/30 PD**
    (and 28/30 had `primaryImage`); Department 12 European Sculpture & Decorative Arts **18/30
    PD**; Department 14 Islamic Art **5/30 PD**; Department 6 Asian Art, `q=ceramics` **10/10 PD**.
    Do not assume "Open Access" means "public domain"; measure every ingest query.
  - The formal website policy pages (`metmuseum.org/policies/image-resources`,
    `/hubs/open-access`) return **429 Vercel Security Checkpoint** from this environment even
    with a browser User-Agent. The CC0 status of the *dataset* is verified (README); the formal
    wording of the *image* policy is **NOT_VERIFIED** here and should be read from a normal
    browser before media bundling.
- Verdict: **USABLE** for metadata (CC0) and for images of `isPublicDomain: true` objects.
  Images of non-PD objects: metadata only, never the image.

### 4.2 Smithsonian Open Access API  **PASS (requires key)**

- Official pages: <https://www.si.edu/openaccess> (2026-11-17) — "download, share, and reuse
  millions of the Smithsonian's images"; "more than 5.2 million 2D and 3D digital items".
  <https://www.si.edu/termsofuse> — content marked with the CC0 icon "is not protected by
  copyright and may be used for commercial and noncommercial purposes without fee or copyright
  restriction"; the icon covers copyright only; the Smithsonian does not guarantee third-party
  rights, publicity or privacy; commercial use of CC0 content needs no further permission.
- API: `https://api.si.edu/openaccess/api/v1.0/search`. Without a key → **403
  `API_KEY_MISSING`** ("Get one at https://api.si.edu"). With the shared demo key
  `DEMO_KEY` → 200; rows carry `content.descriptiveNonRepeating.metadata_usage.access = "CC0"`.
  After ~15-20 requests the demo key returned **429** — it is a test key, not a corpus key.
  A production key must be obtained from `api.si.edu`; key acquisition is a lead-time item for
  the plan.
- Counts observed before the demo-key quota ran out (query + `online_media_type:"Images"`):
  pottery **25,094**; baskets **27,580**; "musical instrument" **16,023**; festival **1,250**;
  food **17,909**. `textile`, `architecture` and `coffee` were **NOT_VERIFIED** (429).
- Media: the search endpoint returns a short row; the docs bundle exposes
  `/api/v1.0/content/{id}` for the full record, where `online_media.media[].usage/rights` is
  expected. That per-media field could not be read here because the demo key was exhausted —
  **NOT_VERIFIED**. Before ingesting media, read the full record and require a CC0 usage field;
  do not infer media rights from the item-level `metadata_usage`.
- Verdict: **USABLE** for metadata (CC0) and likely media (CC0) once a key and the per-media
  field are verified. No embedded image URL was fetched from `ids.si.edu` in this evaluation.

### 4.3 Europeana  **PASS (requires key; per-item rights)**

- Official rights pages fetched 2026-11-17:
  <https://www.europeana.eu/en/rights/usage-guidelines-for-metadata> — **all metadata published
  by Europeana is CC0**; Europeana requests attribution to the data provider and all
  aggregators (including Europeana) and that CC0 links are kept.
  <https://www.europeana.eu/en/rights/public-domain-usage-guidelines> — credit the author and
  the providing institution, keep public-domain marks; for commercial/for-profit use it asks
  users to support public/non-profit providers (a request, not a licence condition).
  <https://www.europeana.eu/en/rights/terms-of-use> — service terms (definitions incl. API-key;
  "Content" excludes metadata enrichments).
- API: `https://api.europeana.eu/record/v2/search.json`. Without `wskey` → **401
  `invalid_apikey`**; empty key → 401 `empty_apikey`. With the documented demo key
  `api2demo` → 200 (used throughout Europeana's own examples; treat as test-only). Production
  keys are requested from Europeana; the current pro.europeana.eu documentation pages returned
  **403** and the knowledge-base page **202 empty** from this environment, so the exact
  registration/rate-limit terms are **NOT_VERIFIED** — but observed response headers include
  `ratelimit-policy: "project";q=1000000;w=3600`.
- Each item carries `rights` (a rightsstatements.org or Creative-Commons URL), and
  `edmIsShownBy`/`edmIsShownAt`/`edmPreview`. The `reusability=open` filter works (coffee:
  12,396 open of 28,125 total) and `media=true` works. Open-rights totals observed:
  architecture **396,176**; music **174,747**; food **158,590**; tradition **20,866**; craft
  **34,013**; language **100,583**; music with media **141,184**.
- Media: sampled open item rights were CC0 and CC BY-SA 3.0; the provider-hosted
  `edmIsShownBy`/`edmPreview` URLs returned 200 image/jpeg. But rights are **per item** and
  providers vary: the API returns InC ("In Copyright") items when not filtered. Any ingestion
  must filter `reusability=open` **and** then allow-list the `rights` URI
  (CC0/PDM/CC BY/CC BY-SA only). Media hosts are arbitrary provider domains — do not hotlink
  them under the current CSP; bundle selected media only after the per-item licence check.
- Verdict: **USABLE** for metadata (CC0, attribution requested) and for a *filtered* open-media
  subset. It is the strongest source for German/European architecture, music, food and
  folklore-adjacent material, but the most rights-heavy to operate.

### 4.4 Wikimedia / Wikipedia / Commons / Wikidata  **PASS**

- Live API facts: Wikipedia Action API 200 (extract); Commons `imageinfo` 200 with
  `extmetadata` (`LicenseShortName`, `LicenseUrl`, `Artist`, `AttributionRequired`,
  `Copyrighted`, `UsageTerms`); Wikidata `Special:EntityData` 200 with `labels` and
  `sitelinks`. Example: `Q241987` (hummus) has ar=حمص بطحينة, de=Hummus, en=hummus,
  descriptions in all three, and arwiki/dewiki/enwiki sitelinks; language items Q13955, Q188,
  Q150, Q1412 all have ar/de/en labels. This is the cheapest way to obtain genuine
  three-language names.
- Licensing, verified from official raw pages:
  - Foundation Terms of Use: text contributions are licensed **CC BY-SA 4.0 (+ GFDL)**,
    reusers may comply with either; **commercial use is allowed**; attribution can be a
    hyperlink to the article/history or a stable copy; share-alike applies to derivative text;
    facts are not copyrightable.
  - `Commons:Licensing`: **non-commercial-only and no-derivatives media are not accepted**
    (commercial use must be allowed); per-file licences are the rule.
  - `Commons:Reusing content outside Wikimedia`: attribute the creator, identify the licence,
    indicate changes, share-alike for derivatives; public-domain works should still be credited
    where possible; the WMF gives no copyright warranty, so per-file verification is required.
  - `Wikidata:Licensing`: all structured data is **CC0**; other namespaces CC BY-SA 4.0.
- API etiquette: <https://www.mediawiki.org/wiki/API:Etiquette> — an informative User-Agent with
  contact information (or risk of IP block), serial requests rather than parallel, pipe multiple
  titles per request, gzip, `maxlag`; no hard read-rate limit but writes are rate-limited.
  The User-Agent policy page itself was not readable via `action=raw` here — **NOT_VERIFIED**,
  but the etiquette page states the requirement.
- Observed Commons category supply (files/subcategories): Arab cuisine 186/66; traditional
  clothing 1,035/23; musical instruments 1,135/99; intangible cultural heritage 44/7; Arab
  culture 100/29; culture of Germany 15/106; cuisine of Germany 24/77; architecture of Germany
  108/56; Arabic calligraphy 962/35. A 12-file sample from Category:Arab cuisine had licences
  CC BY-SA 4.0 ×4, CC0 ×4, CC BY-SA 3.0 ×2, CC BY-SA 2.0 ×1, CC BY 2.0 ×1 — all
  commercial-compatible; none NC/ND (Commons policy forbids them). Thumbnail URLs fetched 200
  image/jpeg.
- Verdict: **USABLE**, with two discipline rules: (1) do **not** copy Wikipedia article text —
  author original summaries from CC0 facts (Wikidata) and cite/link the article; (2) media is
  per file and must be credited (creator + licence + changes). This source is the backbone for
  food and traditions, where museum catalogues are weak, and for language labels.

### 4.5 UNESCO Intangible Cultural Heritage  **METADATA-LINK ONLY / FAIL for content**

- The ICH lists are server-rendered HTML: <https://ich.unesco.org/en/lists> returned 200, and its
  text states **"849 elements corresponding to 5 regions and 157 countries"**. No public JSON/API
  endpoint was found; the list has no documented bulk download. Element pages (e.g. RL 01861)
  return 200 with narrative text and media each credited "© <photographer>, <year>".
- Governing terms: UNESCO general Terms of Use <https://www.unesco.org/en/terms-use> (last update
  15 September 2026) state "Copyright © UNESCO", assert database/compilation rights, and:
  - allowed: browse/cite and reproduce **individual** materials occasionally for personal and
    **non-commercial** educational/research purposes with attribution;
  - prohibited unless separately authorised: **commercial use**, extraction/reuse of a
    substantial part (or repeated/systematic insubstantial extraction), and **automated
    scraping/crawling/bulk download**; text-and-data-mining rights are reserved.
  Site-specific legal/terms pages on `ich.unesco.org` returned 404.
- Consequence: the ICH corpus (849 elements) **cannot be ingested, translated, displayed or
  redistributed** as app content. Even the element list is a substantial part of a protected
  database; scraping it is expressly prohibited. Short citations/links to individual elements
  with UNESCO attribution are defensible for non-commercial use, but a commercial distribution
  should not rely on them. There is **no path** by which UNESCO ICH yields display-ready records
  for this app.
- Verdict: **METADATA-LINK ONLY** (reference links attached to records authored from other
  sources, and only after legal review); **FAIL** as a content source. Do not scrape, translate
  or bundle its text or media.

### 4.6 Art Institute of Chicago API — the reputable alternative  **PASS (media NOT_VERIFIED here)**

- Docs <https://api.artic.edu/docs/> (2026-11-17): no authentication; **anonymous users are
  throttled to 60 requests per minute**; send an `AIC-User-Agent` header naming the project and
  a contact email; search pagination cannot go beyond 10,000 results; **the API contains no
  image files** — images are served by a separate **IIIF Image API 2.0** service; AIC prefers
  hotlinking over scraping; "we cannot offer image dumps at this time"; if scraping, single
  thread and self-throttle; weekly data dumps at `github.com/art-institute-of-chicago/api-data`.
- Licence text returned in every API response: the `description` field is **CC BY 4.0**; all
  other data is **CC0 1.0**. Website terms (fetched with a browser UA): images/data labelled
  "CC0 Public Domain Designation" may be used "for any purpose, including commercial and
  noncommercial uses, without additional permission"; unlabelled images require AIC
  permission/Art Resource licensing; AIC logos/building trademarks are off-limits.
  <https://www.artic.edu/open-access>: "free, unrestricted use of over 50,000 images of works in
  the collection under ... CC0".
- Probed: `/artworks/search?q=coffee` returns `pagination.total = 133,287` (collection-wide;
  the `q` is not reflected in the total), and with
  `query[term][is_public_domain]=true` the total is **62,220** — treat that as the usable
  public-domain pool, not a query count. `/artworks/27992` → `is_public_domain: true`,
  `image_id` present. The IIIF image URL for that object returned **403
  `cf-mitigated: challenge`** from this environment (Cloudflare bot check), so image fetchability
  from an app/browser is **NOT_VERIFIED**; verify in a real browser before adding
  `www.artic.edu` to the CSP image allowlist.
- Verdict: **USABLE** for metadata (CC0 except CC BY descriptions) and for CC0-labelled images;
  media fetchability must be verified before integration.

### 4.7 Rijksmuseum Data Services — additional  **PASS**

- Data services docs <https://data.rijksmuseum.nl/>: Search API, OAI-PMH, LDES, IIIF; the Search
  API is documented at <https://data.rijksmuseum.nl/docs/search/> as
  `GET https://data.rijksmuseum.nl/search/collection` — **"No API key is needed"**; parameters
  include `type`, `material`, `creator`, `imageAvailable`, `creationDate`, `description`,
  `title`, `objectNumber`; returns Linked Art ordered collections (100 per page, `pageToken`).
- Probing: `?imageAvailable=true` → 200 with **totalItems 741,794**; `?type=painting` → 4,929;
  an object (`https://id.rijksmuseum.nl/200100988`) resolves to a Linked Art document whose
  media carries `access_point: https://iiif.micr.io/...` and a rights statement "Public Domain"
  (`creativecommons.org/publicdomain/mark/1.0/`); the IIIF image returned 200 image/jpeg
  (6,694,108 bytes).
- Policy <https://data.rijksmuseum.nl/policy/>: much collection information is public domain or
  CC0 and may be used freely, **including commercially**; where copyright applies a **CC BY 4.0**
  licence applies and the Rijksmuseum must be acknowledged as the source; some in-copyright
  photos are restricted and clearly indicated.
- Verdict: **USABLE** for crafts/architecture with a per-object licence check (PD/CC0 vs CC BY
  4.0 vs restricted). Images are directly fetchable and the IIIF host is a candidate for the CSP
  allowlist.

### 4.8 Digital Public Library of America — additional, backup only  **PASS (auth) / NOT_VERIFIED (rights)**

- `https://pro.dp.la/developers/api-codex` (200) documents `https://api.dp.la/v2` with a
  required 32-character API key appended as `api_key`. A keyless request returned **403
  `invalid_api_key`**. Metadata are aggregated from US providers with per-item rights and
  provider-hosted media; DPLA's own metadata policy has historically been **CC0**, but the
  current licensing pages returned 202 with empty bodies from this environment — **NOT_VERIFIED**
  for 2026. US-centric, provider-dependent media, key required.
- Verdict: **BACKUP ONLY** — do not plan the 500 on it; revisit only if a US-focused category
  needs filling and the licence pages can be verified.

### 4.9 Glottolog — language support  **PASS**

- <https://glottolog.org/meta/downloads> (2026-11-17): "**Glottolog 5.4** ... licensed under a
  **Creative Commons Attribution 4.0 International License**"; releases archived on Zenodo
  (DOI `10.5281/zenodo.596479`; custom downloads `10.5281/zenodo.21676495`). Downloaded the
  official languoid CSV (`glottolog_languoid.csv.zip`, 1,618,235 bytes) from Zenodo record
  21678333: **24,264 rows** — **8,389 languages**, 10,600 dialects, 5,275 families, with stable
  ids, names, level, status and coordinates. Names are English/Latin-script, so Arabic/German
  titles must come from Wikidata (CC0, verified labels) or editorial translation.
- Verdict: **USABLE** for the language category with CC BY 4.0 attribution and the canonical
  citation. Commercial use is allowed by CC BY 4.0.

### 4.10 Sources considered but not planned

- **Library of Congress JSON API** (<https://www.loc.gov/apis/> returned 200): no key, per-item
  rights. Not probed item-level; **NOT_VERIFIED**; keep as an emergency backup.
- **UNESCO publications** (as opposed to the ICH site): some UNESCO publications are CC BY-SA
  3.0 IGO; the ICH website is not offered under that licence and is governed by the Terms of Use
  above. Do not conflate the two.

## 5. What the app may do with each source — operation matrix

`store` = keep metadata in the bundled corpus; `translate` = produce ar/de text from it;
`display` = show in-app; `redistribute` = ship in web/APK corpus; `media-bundle` = ship image
bytes; `media-hotlink` = load remote image at runtime (requires CSP host allowlist).

| Source | store | translate | display | redistribute | media-bundle | media-hotlink |
| --- | --- | --- | --- | --- | --- | --- |
| Met (CC0 metadata) | yes | yes | yes | yes | CC0 `isPublicDomain` images only | `images.metmuseum.org` (already allowed) |
| Smithsonian (CC0 items, key) | yes | yes | yes | yes | only CC0-marked media after per-media check | host not verified; do not allow yet |
| Europeana metadata (CC0) | yes | yes | yes | yes | only per-item open media | provider hosts arbitrary — do not allow |
| Europeana item with InC/unknown rights | no | no | no | no | no | no |
| Wikimedia: Wikidata facts | yes | yes | yes | yes | n/a | n/a |
| Wikimedia: Wikipedia text | only as reference | not copied (author own) | link only | no | n/a | n/a |
| Wikimedia: Commons file (CC0/PD/CC BY/CC BY-SA) | yes | n/a | yes | yes with attribution/licence notice | yes with attribution + share-alike notice for BY-SA | `upload.wikimedia.org`/`thumb.wikimedia.org` candidate |
| Wikimedia: NC/ND-only file | no | no | no | no | no | no |
| UNESCO ICH text/media | no | no | no | no | no | no |
| UNESCO ICH element reference (title/country/year + link) | citation only, legal review | no | link only | link only | no | no |
| AIC metadata (description = CC BY 4.0) | yes | yes | yes | yes + attribution for description | CC0-labelled images only | `www.artic.edu` candidate after browser check |
| Rijksmuseum open objects (PD/CC0 or CC BY 4.0) | yes | yes | yes | yes, acknowledge source | yes per object licence | `iiif.micr.io` candidate |
| Rijksmuseum restricted media | no | no | no | no | no | no |
| DPLA metadata (policy not re-verified) | not yet | not yet | not yet | not yet | no | no |
| Glottolog facts | yes | yes | yes | yes + citation | n/a | n/a |

## 6. Minimum provenance record

The display contract already exists in `src/lib/culture/types.ts` and is enforced by
`src/lib/culture/loader.ts`. **Every corpus record must satisfy that contract**, and the
ingestion pipeline must additionally keep the audit fields below — either in the record itself
or in a sidecar ingestion manifest keyed by id. A record that lacks any REQUIRED field is not
display-ready.

### 6.1 Required fields (REQUIRED unless marked optional)

| Field | Meaning / rule |
| --- | --- |
| `id` | Stable catalog id (opaque; no whitespace/control chars). Namespaced, e.g. `met:45734`, `rijks:200100988`, `wikidata:Q241987`, `glottolog:aari1239`, `commons:File:...`. |
| `version` | `CULTURE_SCHEMA_VERSION` (currently 1). |
| `category` | One of `CULTURE_CATEGORIES`. The six task domains map as in §1. |
| `title {ar,de,en}` | Non-empty in all three (loader drops otherwise). `original`/`originalLanguage` when the source wording differs. |
| `summary {ar,de,en}` | One-two sentences in all three locales. |
| `source.organization` | Human-readable institution ("The Metropolitan Museum of Art"). |
| `source.recordId` | **Addition:** the source's own identifier (objectID / ARK / Q-id / file title). `source.url` alone is not enough to re-fetch. |
| `source.url` | Stable human-facing item URL. |
| `source.license` | Allow-listed id: `CC0-1.0`, `PDM-1.0`, `PD`, `CC-BY-4.0`/`3.0`/`2.0`, `CC-BY-SA-4.0`/`3.0`/`2.0`. No other value may enter the corpus. |
| `source.licenseUrl` | Canonical licence deed URL. |
| `source.attribution` | The exact credit line the UI renders (see §9). Never empty. |
| `source.rightsRaw` | **Addition:** the source's raw rights string/URI (e.g. Europeana `rights` URL, rightsstatements.org URI). Kept for audit; never shown raw. |
| `source.fetchedAt` | **Addition:** ISO date the record was read from the source. Re-check before release. |
| `source.modified` | Optional: the source's own last-modified date when it supplies one. |
| `provenance` | `institution` (institutional text translated only), `machine-translated`, or `editorial-reviewed` (our own reviewed wording). |
| `translations.ar / .de` | **Addition:** `{ status: "reviewed" \| "machine-draft", reviewer?, reviewedAt? }` per locale. Never claim reviewed without a named reviewer and date. |
| `verification` | **Addition:** `{ status: "VERIFIED" \| "REVIEWED" \| "DRAFT", checks: string[], verifiedAt?, verifier? }`. A record is display-ready only at `REVIEWED` or better. |
| `tags` | Source-derived / editorial tags; never invented facts. |
| `place { continent, countries }` | Continent + ISO 3166-1 alpha-2; empty array allowed when the culture is not state-bound. |
| `ingestedAt` | ISO date (already in contract). |
| `media` (optional) | If present: `url` https, `license` allow-listed, `credit` non-empty, plus `fetchedAt` and `rightsRaw` additions; only media whose rights permit redistribution. |

Optional, source-provided only: `period`, `subject` (source's own label, original wording),
`description` (longer text), `related` (genuine metadata relationships), `weight` (editorial
emphasis from documented criteria).

### 6.2 Validation rules the ingestion must enforce

1. **Allow-list gate.** A record whose `source.license` or `media.license` is not in the list
   above is rejected, even if a source says "free". The current loader only checks that the
   license string is non-empty (`loader.ts`), and `format.ts` can even render CC BY-NC/ND
   labels, so the allow-list must be added at ingestion **and** ideally asserted in
   `src/lib/culture/loader.ts` (proposed patch in §11).
2. **All three locales present and reviewed.** The loader already rejects missing ar/de/en
   titles/summaries; the pipeline must additionally refuse to mark a record display-ready while
   any locale is `machine-draft`.
3. **No invented facts.** Every factual claim in a summary must be present in the source record
   (or cited Wikidata statement) captured with the item; otherwise the wording stays generic.
4. **Rights re-check.** `source.rightsRaw` is stored; if a re-fetch shows a different rights
   URI, the record is hidden until re-reviewed.
5. **Media gate.** `media.url` https; media licence allow-listed; credit present; `fetchedAt`
   stored; for bundled media, record the derivative (resize/crop) in `credit`/`attribution`
   as "adapted from".
6. **Provenance honesty.** `provenance=institution` only when the text is the source's own
   wording translated; if we rewrote it, it is `editorial-reviewed` (or
   `machine-translated` pending review). A machine translation may never be labelled
   institution/editorial.
7. **No copy-paste of restrictive text.** Wikipedia/UNESCO/AIC-description text is never copied
   verbatim into the corpus; AIC descriptions (CC BY 4.0) may be translated only with clear
   attribution, and the simpler policy is to author our own summaries from facts.
8. **Completeness gate.** A record without `source.url`, `source.recordId`, `fetchedAt`,
   attribution, three reviewed locales and a verified licence is not counted toward the 500.

### 6.3 Media policy for the current app shell

CSP `img-src` in `scripts/build-headers.mjs` and `scripts/prepare-native-web.mjs` allows only
`'self'`, `data:`, `blob:` and the hosts in `src/lib/culture/media-hosts.json` (currently
`images.metmuseum.org`), and `tests/security/csp-image-hosts.mjs` enforces exact equality
between that registry, both CSP files and the corpus. Consequences:

- **Remote media**: only hosts that are verified fetchable *and* added to the registry may be
  used: Met (already), plus candidates `iiif.micr.io` (Rijksmuseum, verified) and
  `upload.wikimedia.org`/`thumb.wikimedia.org` (Commons, verified); `www.artic.edu` only
  after a browser check (403 from this environment); Europeana/SI providers are not stable
  hosts and should not be allow-listed.
- **Bundled media**: allowed for CC0/PD images without condition, and for CC BY/CC BY-SA with
  attribution + licence notice; avoid bloating the APK — a typographic fallback already exists
  when `media` is absent, so a small curated image set is enough.
- `connect-src 'self'`: the app never calls source APIs at runtime. Ingestion is a build-time /
  offline job. This keeps keys (Smithsonian, Europeana) out of the client and prevents runtime
  rate-limit dependence.

## 7. Realistic sourcing plan for 500 display-ready records

### 7.1 Supply evidence (observed 2026-11-17)

| Source | Observed supply (rights-relevant) | What it can carry |
| --- | --- | --- |
| Met | 44,097 textile / 6,565 basket / 6,675 musical-instrument / 42,620 architecture / 33,773 ceramics search hits with images; dept 18 4,026, dept 12 40,923, dept 6 34,245, dept 14 15,232, dept 19 26,935; PD sample 28/30 (dept 18), 18/30 (dept 12), 5/30 (dept 14), 10/10 (dept 6 ceramics) | crafts, music, objects, some architecture (drawings/photographs) |
| Smithsonian | 25,094 pottery / 27,580 basket / 16,023 musical-instrument / 17,909 food / 1,250 festival image records (CC0) | crafts, music, food history, festival objects |
| Europeana (open only) | architecture 396,176; music 174,747 (141,184 with media); food 158,590; craft 34,013; tradition 20,866; language 100,583 | architecture, music, food, traditions, crafts |
| Rijksmuseum | 741,794 items with image available; 4,929 paintings; per-object PD/CC0 or CC BY 4.0 | crafts, architecture, some food (still life) |
| AIC | 133,287 artworks; 62,220 public domain; >50,000 CC0 images | crafts, architecture, objects |
| Wikimedia | Commons category counts above; Wikidata ar/de/en labels for essentially every documented item | food, traditions, language, images, verification |
| Glottolog | 8,389 languages CC BY 4.0 | language |
| UNESCO ICH | 849 elements, **not redistributable** | reference links only |

### 7.2 Category targets and expected yield

Targets are in the six brief domains and sized to 500; "minimum" is what the rights-checked
sources can safely supply without new editorial writing, and "expected" includes the planned
editorial work. Shortfall is the gap that requires the closing action.

| Domain | Target | Primary sources | Minimum | Expected | Shortfall | Closing action |
| --- | --- | --- | --- | --- | --- | --- |
| traditions (incl. festivals, storytelling, ritual objects, dance) | 80 | Wikimedia/Wikidata (author own text), Europeana open folklore/festival items, Smithsonian festival objects | 55 | 80 | 25 in the worst case | 25 editorial tradition entries (original wording from Wikidata/Commons facts + verified references); link-only ICH references only after legal review (§10) |
| food | 90 | Wikimedia Commons dish photos + Wikidata dish facts, Europeana open food, Smithsonian food-history, Met/Rijks vessels/still life | 75 | 85-90 | 5-15 | 10 additional Commons/Wikidata dish records; Europeana open food with per-item rights |
| music | 90 | Met dept 18 (93% PD sample), Smithsonian instruments, Europeana open music (174k), Commons | 85 | 90-95 | 0-5 | over-index Met instruments |
| crafts | 100 | Met dept 12/6/14, AIC PD, Smithsonian pottery/basketry, Rijksmuseum, Europeana craft, Commons | 95 | 100-105 | 0-5 | over-index Met/AIC CC0 objects |
| architecture | 80 | Europeana open architecture, Rijksmuseum, AIC, Met drawings/photographs, Commons | 70 | 75-80 | 0-10 | prefer pre-1930 buildings/PD photographs; avoid FoP-sensitive modern architecture |
| language | 60 | Wikidata labels/sitelinks (CC0), Glottolog 8,389 languages (CC BY 4.0) | 60 | 60 | 0 | — |
| **Total** | **500** | | **440** | **490-510** | **0-35** | Hold 10-15 surplus in music/crafts as the buffer; if traditions/food still fall short, publish the honest lower number with a documented blocker — never relax provenance to hit 500. |

Allocation sketch (sums to ~500; adjust after a 50-record pilot): Met 80, Smithsonian 65, AIC 35,
Rijksmuseum 45, Europeana 90, Wikimedia/Wikidata 150, Glottolog 35, UNESCO ICH 0 content
(+ optional link references on ≤40 traditions records).

### 7.3 Known shortfalls and their real cause

- **Traditions is the only structural shortfall.** The one canonical register is UNESCO ICH, and
  its terms forbid redistribution. Everything else is either museum objects *about* practices
  (weaker claim) or Wikipedia articles we may not copy. Closing it requires editorial writing
  and verification per item — it cannot be solved by more API calls.
- **Food is the second-riskiest.** Museum collections hold vessels and still lifes, not dishes;
  Europeana open food is heterogeneous and media rights vary. Commons + Wikidata carries it, but
  each record needs editorial care to avoid cultural cliché or invented claims.
- **Music, crafts, architecture and language are supply-safe** once per-object/per-file rights
  filtering is automated. The limiter is media licensing and host allowlisting, not catalogue
  size.
- Language records are cheap in facts but need a point of view (script, family, where spoken,
  one distinctive feature) to be worth displaying; Wikidata/Glottolog give the facts, an editor
  writes the two sentences.

### 7.4 Editorial effort (ESTIMATE — not measured)

500 records × (author one English summary + title/tags) ≈ 100 h; translation to ar/de plus human
review ≈ 165 h; provenance/licence/media QA ≈ 50 h; total ≈ **315 h ≈ 40 person-days** — about
8 weeks for one editor or ~3 weeks for a team of three. This assumes machine-translation drafts
are human-reviewed, never published unreviewed. The 500 count is a content-production goal, not an
engineering task.

### 7.5 Commercial-posture assumption

The plan assumes the app may be distributed commercially (Android/web distribution, paid voice
providers already in the product). Therefore: only commercial-compatible licences (CC0, PDM,
CC BY, CC BY-SA) enter the corpus; no NC/ND, no InC/unknown, no UNESCO ICH content. If the product
later declares itself strictly non-commercial, UNESCO non-commercial quotation becomes arguable
but still not a corpus licence — do not build the corpus on it.

## 8. Recommended ingestion order

Rationale: cheapest legal risk and highest media quality first; sources that need a key and
per-item rights later; editorial-heavy sources last; forbidden/bitter sources never (or links
only). Each step ends with the 50-record pilot and the completeness gate from §6.2.

1. **The Met** — no key, CC0 metadata, verified image host already in CSP, high PD rates in the
   target departments. Seed crafts, music, objects, architecture-drawings.
2. **Rijksmuseum** — no key, verified IIIF media, per-object PD/CC0 or CC BY 4.0. Seed
   crafts/architecture (European).
3. **AIC** — no key, CC0 metadata (CC BY descriptions), >50k CC0 images; verify IIIF fetch in a
   browser before allowlisting `www.artic.edu`. Seed crafts/objects/architecture.
4. **Wikidata + Glottolog** — CC0 labels/sitelinks and CC BY 4.0 language facts; build the
   language domain and the ar/de/en name backbone for all other records.
5. **Wikimedia Commons / Wikipedia** — per-file licences and article facts; author original
   summaries; seed food/traditions and fill media gaps. Follow API etiquette (UA + contact,
   serial, maxlag) and per-file verification.
6. **Smithsonian** — obtain the api.si.edu key first (lead-time); read `/content/{id}` for
   per-media rights; seed crafts/music/food/festival objects.
7. **Europeana** — obtain the production key; filter `reusability=open` and allow-list the
   per-item `rights` URI; seed architecture/music/food/traditions/crafts; bundle selected media
   only (never hotlink arbitrary provider hosts).
8. **UNESCO ICH** — no content ingest. Optionally add link-only references to already-authored
   traditions records after legal review; do not scrape, quote at length, or ship its media.
9. **DPLA** — deferred backup only; revisit only if its current licence pages can be verified.

Pilot gate: ingest 10 records per source/category, run the completeness gate and the CSP media
host test, show them in the real UI in ar/de/en, and only then scale to 500.

## 9. Required attribution UI

Design constraint: the app's quiet surface; attribution must be present without becoming visual
noise, and must be available offline for bundled records.

1. **Per-record credit line** (card + detail): institution or creator, licence short name, and a
   link/route to the licence or credits page. Examples:
   - `The Metropolitan Museum of Art · CC0 1.0`
   - `Rijksmuseum · Public domain` / `Rijksmuseum · CC BY 4.0`
   - `Art Institute of Chicago · CC0 1.0` (description derived: `Art Institute of Chicago · CC BY 4.0`)
   - `Smithsonian Institution · CC0 1.0`
   - Commons: `Photo: <creator> · CC BY-SA 4.0 · Wikimedia Commons` (the TASL pattern: Title,
     Author, Source, Licence)
   - Europeana: `Provided by <data provider> via Europeana · <licence>`
   - Glottolog: `Glottolog 5.4 · CC BY 4.0` with the citation in credits.
2. **Credits screen** (one reachable page, not /about — routing is the lead's ownership): grouped
   by source organization, every licence name and canonical URL, the fetch date of each source
   snapshot, the Glottolog citation, and the Wikimedia Commons attribution list. Link labels and
   heading copy go in a local `COPY` object beside the culture components (the project precedent:
   `DataControls`, `ProviderKey`; `src/lib/i18n.ts` is lead-owned and must not be edited for
   feature copy).
3. **Share-alike notice** for CC BY-SA media and any translated CC BY description: state the
   licence and that the in-app rendering is a derivative (resized/translated). For CC BY-SA
   media, the derivative image/text is offered under the same licence; state it in the credit
   block.
4. **Licence URLs must remain reachable or be bundled**: CC0/PDM/CC BY/CC BY-SA deed links for
   bundled records (or a short licence summary in the credits screen bundled with the app).
5. **No endorsement / no logos**: use the institution's name in text only. AIC terms prohibit
   logos/lion/building images; Wikimedia trademarks are reserved; the UNESCO name/acronym/logo
   require permission. Do not imply the institutions endorse the app.
6. **RTL and translation**: attribution is copy, not data — it must be included in the three
   interface locales via the culture COPY object; source names and licence names are proper nouns
   and stay as written (the loader/format helpers already treat unknown licence ids verbatim).

## 10. Legal constraints and what must never be used

- **Allow-list is binding.** Only CC0-1.0, PDM-1.0/PD, CC BY 4.0/3.0/2.0, CC BY-SA 4.0/3.0/2.0
  may enter the corpus. CC BY-NC*, CC BY-ND*, all-rights-reserved, InC, orphan/unknown, and any
  source whose terms are unclear are excluded. This is what makes an eventual commercial
  distribution safe.
- **CC BY** requires creator + licence + changes notice (commercial use allowed).
- **CC BY-SA** adds share-alike: adaptations (resize/crop/translate) must carry the same
  licence. Keep the adaptation minimal (aspect-preserving downscale) and state it; written
  translations of CC BY-SA text are adaptations — another reason to author original summaries.
  Get the derivative-licensing statement reviewed before shipping BY-SA media.
- **CC0/PDM** require no attribution legally, but the sources (Met, Europeana, AIC, Rijksmuseum,
  Smithsonian) ask for credit. We credit anyway — it is a provenance requirement of this
  project, not just politeness.
- **Europeana** per-item rights are authoritative over the metadata CC0. Never infer media
  rights from the CC0 metadata; read `rights` per item; exclude InC. Europeana asks for
  attribution to data provider + aggregator; PD guidelines ask users not to remove PD marks.
- **UNESCO ICH** is not a content source: no bulk extraction (database right), no commercial
  use, no automated scraping. Even individual quotations are limited to non-commercial
  educational/research use. If the product is commercial, do not display UNESCO wording at all.
- **Wikipedia text** must not be copied into the corpus (share-alike would extend to our
  summaries and translations). Use facts (not copyrightable) and link.
- **Commons media** is per-file; `AttributionRequired`, `Restrictions` and licence fields must
  be read. NC/ND files should not exist on Commons, but always verify. Avoid images with
  identifiable living people where personality rights are unclear, and avoid modern
  architecture in countries without freedom of panorama (prefer pre-1929 buildings or PD
  photographs). Wikimedia gives no copyright warranty.
- **AIC** images are CC0 only when labelled; the `description` field is CC BY 4.0; AIC logos and
  building images are trademarks.
- **Smithsonian** CC0 icon covers copyright only; third-party rights (publicity/privacy) are not
  guaranteed; per-media usage must be read from the full record.
- **Rijksmuseum** CC BY 4.0 objects require acknowledging the Rijksmuseum as source; restricted
  media excluded.
- **Met** images only when `isPublicDomain=true`; the dataset is CC0 but the image policy must be
  read from the website before bundling (currently blocked from this environment — §12).
- **Culturally sensitive material**: do not include sacred/secret objects or practices,
  human remains, or living persons' cultural material presented without context. This is an
  ethical rule the licences do not enforce; editorial review must check it.
- **Data minimisation**: no personal data from source records beyond what the display requires
  (creator names for attribution are required; nothing else).

## 11. Integration constraints and proposed patches outside this document's scope

These are proposals for the owners of those files; this research changes none of them.

1. **CSP/media-host registry** (`src/lib/culture/media-hosts.json`, both CSP scripts, A15 gate):
   if remote media is used, the exact host list must be extended in one commit with the corpus
   change — candidates verified here: `images.metmuseum.org` (already), `iiif.micr.io`,
   `upload.wikimedia.org`, `thumb.wikimedia.org`; `www.artic.edu` only after a browser fetch;
   do **not** add Europeana/provider or Smithsonian hosts until verified. The A15 test already
   enforces equality — keep it green.
2. **Loader licence allow-list** (`src/lib/culture/loader.ts`): `parseCultureItem`/`parseCultureMedia`
   currently accept any non-empty licence string. Proposed: a shared
   `isPermittedCultureLicense(id: string): boolean` (CC0-1.0, PDM-1.0, PD, CC-BY-*-*, 
   CC-BY-SA-*-*) used by the loader; unit tests for accepted/rejected ids (NC/ND/InC/blank).
3. **Provenance additions** (`src/lib/culture/types.ts`): add optional
   `source.recordId`, `source.fetchedAt`, `source.rightsRaw`, `media.fetchedAt`,
   `media.rightsRaw`, `translations?: Record<CultureLocale, { status: "reviewed"|"machine-draft"; reviewer?: string; reviewedAt?: string }>`,
   and `verification?: { status: "VERIFIED"|"REVIEWED"|"DRAFT"; checks: string[]; verifiedAt?: string; verifier?: string }`.
   Keep them optional so `CULTURE_SCHEMA_VERSION` does not need to bump for a corpus-only field.
4. **Docs index** (`DOCUMENTATION_INDEX.md`, lead-owned): add
   `docs/architecture/cultural-sources.md` under Architecture; `npm run check:docs` fails until
   this file is indexed (all files under `docs/` must be listed).
5. **Corpus data location**: no `public/culture` directory exists yet; the loader reads an
   injectable `CultureDataSource`. Decide the bundle location and chunking before the first
   ingestion (the contract assumes index + 100-item detail chunks).

## 12. Verification gaps (NOT_VERIFIED — re-check before reliance)

| Gap | Why it matters | How to close |
| --- | --- | --- |
| Met formal image-resources policy page (429 from this environment) | Confirms the exact CC0 wording for images (dataset CC0 is verified) | Open `metmuseum.org/policies/image-resources` in a normal browser; archive the text |
| Smithsonian per-media rights field (`online_media.media[].usage/rights`) and image fetchability | Media rights must be per item, not item-level metadata | With a production key: `GET /content/{id}` for several image items; fetch one image |
| Europeana production key registration/terms and exact rate-limit policy (pro docs 403/202) | Operating the ingestion within terms | Europeana account docs / support; keep the observed project rate header |
| AIC IIIF image fetchability (403 Cloudflare challenge from this environment) | Remote AIC media may be blocked in-app | Fetch a IIIF URL in a real browser and in the Android WebView; if blocked, exclude from plan |
| DPLA current metadata licence pages (202 empty) | CC0 assumption rests on historical policy | Verify on dp.la/pro.dp.la before any use; otherwise drop DPLA |
| Wikimedia User-Agent policy raw page (not readable via action=raw) | UA/contact is required to avoid blocks | Read on the web; etiquette page already states it |
| UNESCO ICH site-specific terms (404) | General UNESCO ToU is the governing text; ICH-specific rules may exist | Ask UNESCO/read the ICH site footer in a browser before any citation use |
| Rijksmuseum per-object rights distribution (how many are restricted) | Affects how much architecture/crafts material is usable | Sample object documents by `imageAvailable` + read representation rights across categories |
| Translation quality of ar/de drafts | "Display-ready" requires reviewed wording | Editorial review; never label machine output verified |
| Commercial-use review of share-alike derivative media | CC BY-SA obligations for resized/bundled images | Legal review before bundling BY-SA media |

Run the quarter review at each corpus release: sources' terms and API versions change (the Met
retired v1 in October 2026 — any stale integration would have broken silently).

## 13. Evidence appendix — probes with real statuses

All probes run 2026-11-17 from this environment. PASS = expected response verified; FAIL =
blocked/refused/retired, reason recorded; NOT_VERIFIED = could not check.

| # | Probe | Result | Class |
| --- | --- | --- | --- |
| 1 | `GET metmuseum.github.io` | 200; v1.1 docs, 80 req/s, no key, v1 retired 2026-10-01 | PASS |
| 2 | `GET /public/collection/v1/search?q=coffee` | 410 retired | FAIL (expected; v1 removed) |
| 3 | `GET /public/collection/v1.1/search?q=coffee&hasImages=true&limit=3` | 200 `{"total":709,...}` | PASS |
| 4 | `GET /public/collection/v1.1/search?...&isPublicDomain=true` | same total 709 → filter ignored | PASS (negative result recorded) |
| 5 | `GET /public/collection/v1/objects/45734` | 200; isPublicDomain true; primaryImage; rightsAndReproduction empty | PASS |
| 6 | `HEAD images.metmuseum.org/.../DP251139.jpg` | 200 image/jpeg 38,729 B | PASS |
| 7 | `HEAD media.githubusercontent.com/.../MetObjects.csv` | 206; size 341,062,985 B | PASS |
| 8 | Met PD sampling (dept 18/12/14/6) | 28/30, 18/30, 5/30, 10/10 public domain | PASS (sample sizes stated) |
| 9 | `GET api.si.edu/.../search?q=food` without key | 403 API_KEY_MISSING | PASS (key required) |
| 10 | `GET ...&api_key=DEMO_KEY` | 200; metadata_usage.access=CC0 | PASS |
| 11 | SI DEMO_KEY after ~20 calls | 429 (demo quota) | FAIL (expected; not a production key) |
| 12 | SI FAQ / GitHub raw README | 403 / 404 | NOT_VERIFIED |
| 13 | `GET api.europeana.eu/.../search.json` without key | 401 invalid_apikey | PASS (key required) |
| 14 | `...&wskey=api2demo&query=coffee` | 200; rights/edm fields present | PASS |
| 15 | Europeana `reusability=open` counts | architecture 396,176; music 174,747; food 158,590; tradition 20,866; craft 34,013; language 100,583 | PASS |
| 16 | Europeana rate headers | `ratelimit-policy: "project";q=1000000;w=3600` | PASS |
| 17 | Europeana two open media URLs (provider-hosted) | 200 image/jpeg | PASS |
| 18 | Europeana pro docs / API FAQ | 403 / 202 empty | NOT_VERIFIED |
| 19 | Wikimedia Action API (Wikipedia extract) | 200 | PASS |
| 20 | Commons `imageinfo extmetadata` (File:A small cup of coffee.JPG) | 200; CC BY-SA 2.0; Artist; LicenseUrl; AttributionRequired true | PASS |
| 21 | Commons thumbnail fetch | 200 image/jpeg | PASS |
| 22 | Wikimedia ToU / Commons Licensing / Reuse / Wikidata Licensing raw | 200 each; CC BY-SA 4.0 text, NC/ND not accepted, CC0 Wikidata | PASS |
| 23 | Wikimedia API etiquette page | 200; UA with contact, serial requests, maxlag | PASS |
| 24 | Wikimedia User-Agent policy raw | 59-byte fragment | NOT_VERIFIED |
| 25 | Wikidata Q241987 labels/sitelinks | ar/de/en labels + descriptions + arwiki/dewiki/enwiki | PASS |
| 26 | ICH lists page | 200 HTML; "849 elements, 5 regions, 157 countries" | PASS |
| 27 | ICH element page | 200; narrative + "© photographer" credits | PASS |
| 28 | UNESCO Terms of Use | 200; copyright © UNESCO; non-commercial quotation; scraping prohibited | PASS |
| 29 | ICH-specific legal/terms pages | 404 | NOT_VERIFIED |
| 30 | AIC API docs / openapi | 200; no auth; 60 req/min; AIC-User-Agent; 10k pagination cap; no image files | PASS |
| 31 | AIC search / artwork detail | 200; PD pool 62,220; is_public_domain true; image_id | PASS |
| 32 | AIC IIIF image URL | 403 cf-mitigated challenge | NOT_VERIFIED (in-app fetch) |
| 33 | AIC terms / open-access pages (browser UA) | 200; CC0-labelled images commercial OK; >50k CC0 images; description CC BY 4.0 | PASS |
| 34 | Rijksmuseum Search API docs | 200; no key; `/search/collection` params | PASS |
| 35 | `GET data.rijksmuseum.nl/search/collection?imageAvailable=true` | 200; totalItems 741,794 | PASS |
| 36 | Rijksmuseum object + IIIF image | 200; "Public Domain" rights; 200 image/jpeg 6,694,108 B | PASS |
| 37 | Rijksmuseum policy page | 200; PD/CC0 freely incl. commercial; CC BY 4.0 requires acknowledgement | PASS |
| 38 | DPLA API docs / keyless request | 200 docs; 403 invalid_api_key | PASS (key required) |
| 39 | DPLA current licence pages | 202 empty | NOT_VERIFIED |
| 40 | Glottolog downloads + Zenodo CSV | 200; CC BY 4.0; 24,264 rows / 8,389 languages | PASS |
| 41 | Met image policy pages | 429 Vercel checkpoint (browser UA too) | NOT_VERIFIED |
| 42 | Met archive.org snapshots | 429 | NOT_VERIFIED |

## 14. Decisions

| # | Decision | Basis |
| --- | --- | --- |
| D1 | Licence allow-list: CC0-1.0, PDM-1.0/PD, CC BY 4.0/3.0/2.0, CC BY-SA 4.0/3.0/2.0 only; no NC/ND/InC/unknown. | commercial-posture assumption; Commons policy; Europeana per-item rights |
| D2 | Museum/aggregator metadata (Met, SI, Europeana, AIC, Rijksmuseum, Wikidata, Glottolog) is the corpus backbone; media is gated separately and per item/file. | verified metadata licences; media rights differ |
| D3 | UNESCO ICH is not a content source; link-only references at most, after legal review; no scraping, translation or media. | UNESCO ToU (commercial use and systematic extraction prohibited) |
| D4 | Wikipedia article text is not copied; summaries are authored from CC0 facts and cite/link the article. | CC BY-SA share-alike would otherwise extend to our summaries and translations |
| D5 | All 500 records require three reviewed locales; machine drafts never count as display-ready. | `CultureItem` contract requires ar/de/en; project evidence rules forbid unverified claims |
| D6 | Media plan: hotlink only verified hosts added to `media-hosts.json` + CSP; bundle only CC0/PD (or attributed CC BY/SA) images; otherwise use the existing typographic fallback. | A15 CSP gate; offline-first app; APK size |
| D7 | Every record carries full provenance (`source.recordId`, licence, licence URL, attribution, fetchedAt, rightsRaw, per-locale review, verification); incomplete records do not count. | auditability; sources' terms change |
| D8 | The realistic 500 is reachable from Met + Rijksmuseum + AIC + Wikimedia/Wikidata + Glottolog + Smithsonian + Europeana; traditions/food carry the shortfall risk and need editorial closing; if it cannot close, publish 470-490 with a documented blocker, never relax provenance. | observed supply + rights analysis + effort model |
| D9 | Ingestion order: Met → Rijksmuseum → AIC → Wikidata/Glottolog → Wikimedia Commons → Smithsonian (key) → Europeana (key) → ICH references → DPLA deferred. | legal risk, media quality, key lead-time, editorial weight |

## 15. Official references (all fetched 2026-11-17)

- Met: <https://metmuseum.github.io/> · <https://github.com/metmuseum/openaccess> ·
  <https://www.metmuseum.org/policies/image-resources> (429 — NOT_VERIFIED)
- Smithsonian: <https://www.si.edu/openaccess> · <https://www.si.edu/termsofuse> ·
  <https://edan.si.edu/openaccess/apidocs/>
- Europeana: <https://www.europeana.eu/en/rights/usage-guidelines-for-metadata> ·
  <https://www.europeana.eu/en/rights/public-domain-usage-guidelines> ·
  <https://www.europeana.eu/en/rights/terms-of-use> · <https://api.europeana.eu/record/v2/search.json>
- Wikimedia: <https://www.mediawiki.org/wiki/API:Etiquette> ·
  <https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use> ·
  <https://commons.wikimedia.org/wiki/Commons:Licensing> ·
  <https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia> ·
  <https://www.wikidata.org/wiki/Wikidata:Licensing>
- UNESCO: <https://ich.unesco.org/en/lists> · <https://www.unesco.org/en/terms-use>
- AIC: <https://api.artic.edu/docs/> · <https://www.artic.edu/terms> ·
  <https://www.artic.edu/open-access> ·
  <https://github.com/art-institute-of-chicago/api-data>
- Rijksmuseum: <https://data.rijksmuseum.nl/> · <https://data.rijksmuseum.nl/docs/search/> ·
  <https://data.rijksmuseum.nl/policy/>
- DPLA: <https://pro.dp.la/developers/api-codex>
- Glottolog: <https://glottolog.org/meta/downloads> · DOI `10.5281/zenodo.596479` ·
  <https://zenodo.org/records/21678333>
- Internal: `src/lib/culture/types.ts`, `src/lib/culture/loader.ts`,
  `src/lib/culture/media-hosts.json`, `tests/security/csp-image-hosts.mjs`,
  `scripts/build-headers.mjs`, `scripts/prepare-native-web.mjs`;
  raw probe log `artifacts/phase2/task-13.md` (gitignored).

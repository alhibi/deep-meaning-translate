# today — Deep Meaning Translate

A meaning-first translator for **Arabic ⇄ German**, built as one focused screen. It translates
intent, tone, register and idiom rather than replacing words, and it keeps the draft, the pair
and the last translation on the device so returning to the screen never feels like reopening an
app.

Live: https://fluently.today/

## Android app (1.1.0)

The same translator is packaged as an Android app: the React shell runs in a Capacitor WebView,
while Kotlin/Room/DataStore own device records, settings, backups and the native lifecycle. The
1.1.0 build runs on AGP 9.5.2 + Gradle 9.8.1 + built-in Kotlin 2.4.21, compileSdk/targetSdk 37,
Room 2.8.5 and DataStore 1.3.0 (see [ANDROID_STACK_UPGRADE_1_1_0.md](ANDROID_STACK_UPGRADE_1_1_0.md)).
The installable APKs are published with the repository:

- **[Download the latest Android build](https://github.com/alhibi/deep-meaning-translate/releases/latest)**
  — attach the debug APK (package `today.fluently.app.debug`) for daily use or the release-review
  APK (package `today.fluently.app`, debug-signed) to test the minified build.
- Every release lists its SHA-256 checksums and signing type; the release-review APK is **not** a
  Play Store artefact until an upload key is configured (see TD18 in
  `docs/audits/technical-debt.md`).
- Android evidence: [ANDROID_TEST_EVIDENCE.md](ANDROID_TEST_EVIDENCE.md),
  [ANDROID_RELEASE_REPORT.md](ANDROID_RELEASE_REPORT.md), and
  [docs/android/build-and-release.md](docs/android/build-and-release.md).
- **Optional personal key:** in the installed app, the About page's Advanced section lets you paste
  your own DeepSeek key. It stays in the app's private storage, is excluded from backups, never goes
  to the today server, and is used for direct DeepSeek calls with your own quota (ADR 0009). This
  is the fallback when a phone's network cannot reach the deployed service.

## What the product actually does

- **Meaning-first translation** into Arabic or German, with Natural / Formal / Casual register.
  Arabic output can follow Modern Standard Arabic or a regional variety (Levantine, Egyptian,
  Gulf, Iraqi, Maghrebi).
- **Live mode**: plain text streams while you type; a finished sentence or settled pause gets a
  structured, checked result. The stable source field preserves native editing and IME confirmation;
  a previous translation cannot be saved or copied as the result of a new draft.
- **Source detection with a local sanity check**: a strong writing-system mismatch is sent to the
  model as `auto` instead of a false source; same-script guesses only produce a dismissible hint.
- **Reliability layer**: deterministic checks for numbers (both numeral systems), URLs, emojis,
  names, paragraph structure, question marks and Arabic punctuation. A failed check triggers one
  quiet repair pass; a repair is shown only if it clears more issues than it creates.
- **Device memory**: settled, verified sentences are answered locally on later visits. Nothing
  leaves the device for this cache.
- **Voice**: device speech, plus cloud read-along with word timing where the provider supplies it.
  Text is never logged.
- **Sentence Shadow**: on a settled translation, a second pass can point at a phrase that shifted
  meaning; applying a fix is a display overlay keyed to that exact translation.
- **Statistics** (`/stats`): a local, private and `noindex` translation archive with timelines,
  language flow, rhythm, milestones, an interactive **practice map** (centre topic, ranked orbits,
  a day-trail ring and a typographic readout) and editable classifications.
- **A web app that feels installed**: the streamed answer arrives word by word on a deliberate
  "whirlwind" while a caret marks live generation; provider deltas are coalesced to one paint per
  animation frame; a dismissible update pill appears when a new service worker takes over; storage
  health (quota, durability, archive rows, failed/trimmed writes) is visible on the About page.
- **Contextual local weather** under the translator: an optional, approximate location (explicit
  consent, no tracking, no raw fix stored) renders a compact strip with a real forecast from
  Open-Meteo, a manual city alternative, units, freshness/offline labels and visible attribution;
  provider failures keep the last valid forecast and never affect translation.
- **Cultures, people and everyday life**: a written, text-first cultural knowledge library below the weather - hundreds of three-language articles on social behaviour, language and communication, traditions, family, food, work, cities and cultural change, with a deterministic daily discovery, mixed editorial compositions, search and filters, saved articles, related reading, references and offline browsing. No images, no museum catalogue, no runtime model calls.
- **One public page** (`/about`): product explanation, the meaning-first philosophy, the data
  disclosure and the controls; `/privacy` and `/arabic-german-translation` are permanent redirects
  into its sections, the sitemap lists only `/` and `/about`, and a first-run introduction is
  server-rendered so it never covers a painted translator.

Two models are selectable: **DeepSeek** (presented as Velo) is the default writer, and
**Luna** (OpenCode, presented as Sona) is the expressive writer. Selection is **strict**: the chosen
model is the only writer, there is no automatic fallback or cross-model review, and an unavailable
model fails visibly with a retry instead of being answered by the other one. The first input and any
model change start a full, verified request immediately — there is no provisional-then-settled
second request or artificial pause. Provider routing lives only in `engine.server.ts` / the
translate-stream route.

The interface presents those brains under their product names: `deepseek` is **Velo** and
`luna` is **Sona**. Internal ids, provider endpoints, environment keys and routing keep their
technical names, so a rename is presentation only.

The contextual weather strip and the cultural library are built, tested and still routed, but they
are **switched off in the translator in this release** (`src/lib/features.ts`); their components,
hooks, data, routes and tests remain in the tree.

## Stack

TanStack Start + TanStack Router, React 19, Vite 8, Tailwind CSS 4, TypeScript, Zod, Vitest,
vite-plugin-pwa. The production build targets a Cloudflare Worker; `scripts/serve-build.mjs` runs
that exact bundle on Node for local preview.

## Setup

Requires Node.js 22.12 or newer.

```sh
npm ci
cp .env.example .env   # DEEPSEEK_API_KEY and/or OPENCODE_API_KEY for real translations
npm run dev            # http://localhost:8080
```

The UI is fully explorable without a provider key; translation requests fail with a calm state
instead of falling back to fake output.

## Gates

```sh
npm run typecheck        # tsc --noEmit
npm run lint             # eslint, zero warnings
npm run test             # vitest + coverage floors
npm run check:contrast   # every theme pair clears WCAG AA
npm run check:docs       # links and documentation inventory
npm run check:security   # cultural content gate; text-first, image-free ≡ CSP (web + native), Permissions-Policy guard
npm run build            # build + security headers + PWA precache check
npm run culture:validate # corpus gates: count, countries, continents, categories, extended, locales
npm run freshness        # dependency versions vs npm registry (report; see docs/quality/freshness.md)
npm run verify           # typecheck + lint + tests + contrast + docs + security
```

At the close of the 2026-11-16 web upgrade: **461 tests passed, 4 skipped, 75 files**; **51
contrast pairs** passed; the build precached **56 files / 54 hashed assets**; typecheck and lint were
clean and the production preview served an offline relaunch from its service worker. The CI
workflow's verify and Android jobs both passed on GitHub for the final commit (run 43975244977).

`npm run test:e2e` runs the phone-sized Playwright scripts in `tests/e2e/` against a running app
(`http://localhost:8080`). They need `playwright` for Python and are **not** part of CI.

### Production preview

```sh
npm run build && npm run preview   # http://localhost:8080
```

`vite preview` cannot serve a Worker build; the adapter replays the generated `_headers`.

## Where things live

| Path                                      | Responsibility                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `src/routes/index.tsx`                    | The translator screen: composition, boot restore, session persistence  |
| `src/routes/__root.tsx`                   | Shell, pre-paint theme/locale/intro scripts, error screens             |
| `src/lib/translation/`                    | Scheduler, streaming, prompt, providers, parsing, verification, memory |
| `src/lib/persist.ts`                      | Validated device persistence and the tab's remembered values           |
| `src/lib/theme.ts`                        | Three validated themes, pre-paint boot, browser-chrome colour          |
| `src/lib/i18n.ts`                         | Interface locale, pre-paint direction, RTL                             |
| `src/lib/voice/`                          | Device and cloud speech, PCM player, timing                            |
| `src/lib/stats/`, `src/components/stats/` | Pure statistics engine, taxonomy, practice map and charts              |
| `scripts/`                                | Build guarantees: headers, PWA, contrast, docs, social card, preview   |
| `docs/`                                   | The authoritative engineering knowledge base                           |

## Documentation

Start with [AGENTS.md](AGENTS.md) for the operating contract and
[DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md) for every document, its scope and its status.
The permanent product and engineering rules are in
[PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md); completed work is defined in
[DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md).

The audit that produced this documentation is in
[docs/audits/2026-11-07-baseline-and-repairs.md](docs/audits/2026-11-07-baseline-and-repairs.md)
and the Arabic report is [docs/audits/final-report-ar.md](docs/audits/final-report-ar.md).
`AUDIT.md` and the root Arabic reports are historical records from earlier passes, not current
specifications.

## Limits

- Provider output quality cannot be asserted without keys and a human-reviewed corpus; see
  [docs/translation/evaluation.md](docs/translation/evaluation.md).
- The interface copy is translated after hydration; only direction and document language are set
  before paint. SSR still emits English copy.
- Rate limiting is process-local; deployment-wide abuse protection belongs at the hosting edge.
- No claim of universal device or browser coverage is made. Tested surfaces are listed in
  [docs/quality/testing.md](docs/quality/testing.md).

This project is connected to Lovable. Do not rewrite published history; keep the connected branch
working.

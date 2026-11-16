# today — Deep Meaning Translate

A meaning-first translator for **Arabic ⇄ German**, built as one focused screen. It translates
intent, tone, register and idiom rather than replacing words, and it keeps the draft, the pair
and the last translation on the device so returning to the screen never feels like reopening an
app.

Live: https://fluently.today/

## Android app (1.0.3)

The same translator is packaged as an Android app: the React shell runs in a Capacitor WebView,
while Kotlin/Room/DataStore own device records, settings, backups and the native lifecycle. The
installable APKs are published with the repository:

- **[Download the latest Android build](https://github.com/alhibi/deep-meaning-translate/releases/latest)**
  — attach the debug APK (package `today.fluently.app.debug`) for daily use or the release-review
  APK (package `today.fluently.app`, debug-signed) to test the minified build.
- Every release lists its SHA-256 checksums and signing type; the release-review APK is **not** a
  Play Store artefact until an upload key is configured (see TD18 in
  `docs/audits/technical-debt.md`).
- Android evidence: [ANDROID_TEST_EVIDENCE.md](ANDROID_TEST_EVIDENCE.md),
  [ANDROID_RELEASE_REPORT.md](ANDROID_RELEASE_REPORT.md), and
  [docs/android/build-and-release.md](docs/android/build-and-release.md).

## What the product actually does

- **Meaning-first translation** into Arabic or German, with Natural / Formal / Casual register.
  Arabic output can follow Modern Standard Arabic or a regional variety (Levantine, Egyptian,
  Gulf, Iraqi, Maghrebi).
- **Live mode**: plain text streams while you type; a finished sentence gets the structured,
  verified result.
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
- **Statistics** (`/stats`): computed locally from the history archive; private and `noindex`.
- **Public pages** (`/privacy`, `/arabic-german-translation`), a sitemap, an offline shell, and a
  first-run introduction that is server-rendered so it never covers a painted translator.

The default and only active writer is **DeepSeek**. The OpenCode/Luna provider is implemented but
paused (`LUNA_ENABLED = false`); no request silently switches providers while it is paused.

## Stack

TanStack Start + TanStack Router, React 19, Vite 8, Tailwind CSS 4, TypeScript, Zod, Vitest,
vite-plugin-pwa. The production build targets a Cloudflare Worker; `scripts/serve-build.mjs` runs
that exact bundle on Node for local preview.

## Setup

Requires Node.js 22.12 or newer.

```sh
npm ci
cp .env.example .env   # at least DEEPSEEK_API_KEY for real translations
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
npm run build            # build + security headers + PWA precache check
npm run verify           # typecheck + lint + tests + contrast
```

At the close of the 2026-11-07 audit: **300 tests passed, 4 skipped, 50 files**; **51 contrast
pairs** passed; the build precached **37 files**; typecheck and lint were clean.

`npm run test:e2e` runs the phone-sized Playwright scripts in `tests/e2e/` against a running app
(`http://localhost:8080`). They need `playwright` for Python and are **not** part of CI.

### Production preview

```sh
npm run build && npm run preview   # http://localhost:8080
```

`vite preview` cannot serve a Worker build; the adapter replays the generated `_headers`.

## Where things live

| Path                    | Responsibility                                                         |
| ----------------------- | ---------------------------------------------------------------------- |
| `src/routes/index.tsx`  | The translator screen: composition, boot restore, session persistence  |
| `src/routes/__root.tsx` | Shell, pre-paint theme/locale/intro scripts, error screens             |
| `src/lib/translation/`  | Scheduler, streaming, prompt, providers, parsing, verification, memory |
| `src/lib/persist.ts`    | Validated device persistence and the tab's remembered values           |
| `src/lib/theme.ts`      | Three validated themes, pre-paint boot, browser-chrome colour          |
| `src/lib/i18n.ts`       | Interface locale, pre-paint direction, RTL                             |
| `src/lib/voice/`        | Device and cloud speech, PCM player, timing                            |
| `src/lib/stats/`        | Pure statistics engine and taxonomy                                    |
| `scripts/`              | Build guarantees: headers, PWA, contrast, docs, social card, preview   |
| `docs/`                 | The authoritative engineering knowledge base                           |

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

<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Start here

This file is the operating contract. It is deliberately short on architecture detail: the
knowledge lives in `docs/`, and this file says which document wins and how to change code safely.

| Question | Source of truth |
| --- | --- |
| What the product is, and what it refuses to become | `PROJECT_CONSTITUTION.md`, `docs/product/` |
| Where code lives and what depends on what | `PROJECT_MAP.md`, `docs/architecture/overview.md` |
| Why navigation, theme and restore behave this way | `docs/architecture/navigation-and-lifecycle.md` |
| How a translation is produced and verified | `docs/translation/` (prompts live only in `src/lib/translation/prompt.ts`) |
| What must be true before calling work done | `DEFINITION_OF_DONE.md` |
| How to test, build and release | `docs/quality/testing.md`, `docs/operations/development-and-release.md` |
| Security boundaries and privacy claims | `docs/security/privacy-and-threat-model.md` |
| Known debt and unverified areas | `docs/audits/technical-debt.md` |

Authority order when documents disagree: **verified implementation and executable gates** →
approved decisions (`docs/architecture/decisions/`) → current specifications → this file →
historical notes and proposals. Reconcile the contradiction; never silently pick a side.

### Commands

```sh
npm ci
npm run dev              # http://localhost:8080
npm run verify           # typecheck + lint + tests + contrast
npm run check:docs       # documentation links and inventory
npm run build            # production Worker bundle + headers + PWA check
npm run preview          # serve the built Worker on Node
```

### Change workflow

1. Read the relevant document and the code path it names. Never document a capability before
   tracing its execution path.
2. Reproduce the defect, then fix its cause. Keep the smallest coherent change; no unrelated
   refactors, no new abstraction without a concrete justification.
3. Add or update a regression test. A bug fix without a test is unfinished.
4. Run the narrowest check that covers the change, then `npm run verify`. Run the build when
   routing, bundling, headers, the service worker or server code changed.
5. Update the documents whose **Scope** covers the change. If behaviour and documentation
   disagree, the implementation is evidence and the document must be corrected — unless the
   implementation is the defect, in which case fix it and record the decision.
6. Record new debt in `docs/audits/technical-debt.md`; never label unresolved work as fixed.

### Hard rules

- Never fabricate a test result, a measurement or an audit. Use the classifications in
  `docs/quality/testing.md` (VERIFIED / OBSERVED / SUSPECTED / NOT_VERIFIED).
- Never commit, print or document secret values. Provider keys are read only in server handlers.
- Never rewrite published Git history, force-push, or leave the connected branch broken.
- Preserve the product's meaning-first identity and the one-screen workflow.
- Preserve user data and device persistence; any migration must read old values through a
  validator and keep a rollback path.

- Everything read back from device storage goes through a validator (parsePrefs/parseSession/isResult/isPhrase/isEntry) mirroring the server input schema — corrupted or stale data must never reach the server or crash the UI.
- "Forget everything" goes through `clearDeviceData()` (`src/lib/clearData.ts`): it resets the history, phrasebook and translation-memory caches before removing `lingua.*` values — why: removing storage keys alone leaves a cleared translation answerable from RAM.
- Two-brain translation: the request's `brain` field (default from DEFAULT_BRAIN in types.ts) picks the writer; the other model is the automatic fallback, and DeepSeek reviews only Luna-written sentences. All provider routing lives in engine.server.ts / translate-stream route; the app must still work with only one key.
- Stats are computed locally from the history archive (lingua.history.v1); no separate store — keeps one source of truth and old rows.
- Source-language sanity lives in `languageCheck.ts` (pure, local): a writing-system mismatch sends `source: "auto"` to the model and shows a dismissible hint; same-script mismatches only hint — why: a wrong pick must never mislead the model, and a false warning is worse than none.
- All spoken output goes through `src/lib/tts.ts` (device Web Speech, chunked, watchdog, kept utterance reference); UI never calls speechSynthesis directly — why: Android/Chrome drop speech silently without these guards.
- Cloud read-along uses the output audio clock mapped to cumulative PCM samples, excluding buffering gaps; request trimming preserves original text offsets and each UI playback is generation-guarded — why: highlights must follow audible content without early words or stale callbacks.
- Cloud speech uses `/api/speak` (Gemini PCM) or `/api/eleven-speak` (ElevenLabs timestamped PCM); keys are read only in handlers and text is never logged. Shared validated parsers, provider-isolated cache/circuit breakers, timing metadata and the gapless player live in `src/lib/voice`; all prefetch/playback goes through `tts.ts` with device fallback — why: early audio, accurate read-along where timestamps exist, no duplicate preparation or client secrets.
- Voice preferences migrate once to a versioned local store, preserving the device-voice choice and adopting the new cloud default otherwise — why: upgrades must retain validated settings without forcing offline users onto a paid service.
- Public translation guidance lives in a separate, linked route with its own metadata and sitemap decision; keep the homepage as the usable translator and private archive routes excluded — why: search content must not displace the translation workflow or expose local records.
- Theme selection is validated centrally in theme.ts, restored before paint, and applied through global semantic tokens; renamed themes migrate to their replacements, system preference supplies an unset default — why: preserve saved choices, safe storage and no first-paint flash across routes.
- Dictation uses server-issued AssemblyAI temporary tokens and browser AudioWorklet PCM via useAssemblySpeech; turn-order replacement preserves intentional repetition, auto source omits language steering, and stop waits for the final turn — why: keep permanent credentials hidden and prevent dropped or duplicated words.
- Sentence Shadow (`src/lib/translation/shadow*.ts`, `useShadow.ts`): runs only on settled translations, the model quotes fragments and all offsets are re-anchored locally (unanchorable findings dropped), and applied fixes are a display overlay keyed to the exact model translation that also updates history/saved — why: a shadow must never point at nothing, never flicker while typing, and one apply path keeps Copy/voice/archive consistent.
- Raw paid-service requests share bounded JSON and same-origin checks in requestSafety.ts; translation admission is keyed by trusted proxy client address, with bounded process-local state — why: oversized inputs and one runaway client must not block unrelated users; deployment-wide bot protection still belongs at the hosting edge.
- Provider streams require their protocol completion event before being committed or cached; cancelling a response aborts its upstream request, and cloud feeds bound inactivity — why: truncated audio/text and disconnected consumers must not silently become successful results or hang forever.

- Every "the app responded" moment goes through the `feel` façade (`src/lib/feel/`): call sites name _what happened_ (`feel.confirm()`, `feel.arrive()`), never _how_. Whether that becomes vibration, a synthesised tone, both, or nothing is decided in one place from the person's settings and the device's limits — why: 15 call sites cannot each remember that sound is off, or that a reduced-motion device must stay still. Settings are read at call time, so a toggle applies to the next tap with no re-render. There are **no audio files**: every voice is built from one shared `AudioContext` created lazily inside a user gesture.
- Device translation memory (`src/lib/translation/memory.ts`) answers a sentence settled in an earlier session with zero requests. Only settled, verified results are stored — a provisional stream never went through `verify`, so storing one would let an unchecked reading answer for that text forever. Bounded twice (120 rows _and_ 200 KB), 30-day TTL, validated on read, device-only. jsdom shares `localStorage` across tests in a file, so a test that exercises the network path must `memoryClear()` first or a previous test's sentence will answer for it.
- Three themes and only three (`dark` clay, `light` paper, `vivid` electric). The class on `<html>` _is_ the theme name, so `theme.ts` and `styles.css` share no mapping table that could drift. A new theme is a new CSS block plus a line in `THEMES` — and `scripts/check-contrast.mjs` will fail the build until all 17 pairs clear their ratio.
- `npm run check:contrast` is a CI gate, not a report. It reads the real tokens out of `styles.css`, follows `var()` indirection and composites translucent values over the surface they are drawn on. Text pairs need 4.5:1 with no exceptions; the focus indicator needs 3:1 and is **solid `--ring`, never a tint** — a 55% tint measured 2.06–2.55:1 and was invisible to a keyboard user. Hairline borders are reported, not gated, because in this design no border is the sole affordance for anything.
- View Transitions are shared by two movements that must not fight: navigation crosses over, the theme _spreads_ from the touch point and drives its own clip-path. `theme.ts` puts `html.theme-reveal` on the document for exactly the lifetime of the theme transition; while it is present the default root fade is suppressed. Adding a third View Transition means deciding which of the two it belongs to.
- Sheets are `lazy()` and closed on first paint, so they load on demand instead of sitting in the entry chunk. Their chunks are hashed and precached with the shell, so this costs an offline user nothing. A new overlay belongs in the same `Suspense` boundary.
- The first-run intro is **not** lazy and **is** server-rendered: `INTRO_BOOT` sets `data-intro="open"` before paint and CSS decides whether it is shown. Why: a lazy intro painted the translator first and covered it a second later — and the cover's icon became the LCP element at 2.7 s. Server-rendering it gives a first visit real content immediately, with no overlay flash for either visitor; the `noscript` rule in `__root` hides it when JavaScript cannot open the app.

- Zero-tolerance gates: `tsc`, `eslint --max-warnings 0`, `vitest` and `vite build` run in CI on every branch (`.github/workflows/ci.yml`). `react-hooks/*` findings that are deliberate carry an inline reason; never delete a disable comment without replacing the pattern.
- Typography is self-hosted (`@fontsource*` imported in `src/styles.css`). Never add a font CDN: the shell must render correctly offline and without a third-party origin in the critical path.
- The service worker precaches the app shell into `.output/public` (`outDir`) and serves `/offline.html` only when a navigation fetch fails and no document is cached (no `navigateFallback` route; `tests/e2e/pwa_navigation.py` guards two online navigations with the worker active). `scripts/check-pwa.mjs` fails the build if the precache empties — a worker that caches nothing cannot open the app offline.
- Security headers are generated after the build (`scripts/build-headers.mjs`) because the platform rewrites `_headers` last. CSP allows inline scripts only because TanStack streams per-route hydration data; every other vector is closed (no third-party script, no framing, no `<base>`, no cross-origin forms).
- Rate limits are per purpose (`takeLiveToken` provisional typing, `takeToken` settled translation, `takeEnrichmentToken` dictionary/shadow, `takeRepairToken` silent second pass, `takeSpeechToken` cloud voice, `takeDictationToken` AssemblyAI sessions). Never let background work spend the typing budget, and never surface a rate message for a live request while someone is still typing.
- Dialogs own their focus: every sheet uses `useFocusTrap` (focus in, Tab wraps, focus returns to the opener) and is `role="dialog" aria-modal`. New overlays must do the same.
- Failure surfaces are product surfaces: the 404 and error screens (`src/components/FailureScreen.tsx`) and the last-resort page (`src/lib/error-page.ts`) are translated, calm and self-contained. No status codes or stack traces are shown to a person.
- Time is an external system: read "today" through `useTodayKey()` (a `useSyncExternalStore`), never `Date.now()` during render — the statistics page must roll over at midnight without a reload.
- Verification is deterministic and quiet: `verify.ts` checks numbers in both numeral systems, names (skipping paths where transliteration is correct), question marks, Arabic punctuation and invented explanations. A repair is only shown if it clears more issues than it creates.
- Public pages (`/arabic-german-translation`, `/privacy`) are linked from the translator's footer and included in the sitemap; `/stats` stays private (`noindex`) and out of the sitemap.
- Quiet background work (dictionary lookup, sentence shadow, second-pass review) passes through `enqueueEnrichment` in `src/lib/translation/enrichment.ts`: one request at a time, a short gap, a hang timeout, and a rejection never blocks the queue. Foreground translation never goes through it.
- The suggestion of a different style is a pure function (`src/lib/translation/suggestion.ts`), shown once per text and style, and only when the model's reading of the situation disagrees with the chosen style.
- Top-bar controls live in `src/components/translator/AppHeader.tsx`, and the animated name in `Wordmark.tsx`; `src/routes/index.tsx` composes them instead of inlining markup, and Testing Library cleanup is registered in `src/test/setup.ts` (globals are off, so it does not happen by itself).

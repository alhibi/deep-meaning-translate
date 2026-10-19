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

- Everything read back from device storage goes through a validator (parsePrefs/parseSession/isPhrase/isEntry) mirroring the server input schema — corrupted or stale data must never reach the server or crash the UI.
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

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

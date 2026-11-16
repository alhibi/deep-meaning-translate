# ADR 0009 — Optional personal provider key (direct mode)

Status: **Accepted** (2026-11-16). Extends, and does not replace, ADR 0007 (native API surface)
or ADR 0005 (Capacitor hybrid shell).

## Context

The installed app normally sends translation requests to the deployed Worker, which holds the
provider keys. That protects the keys and gives every user a working provider without an account.
Two real problems remain for a personal device:

1. A phone whose network cannot reach the Worker (corporate DNS, regional filtering, a broken
   proxy) cannot translate at all, even though api.deepseek.com may be reachable.
2. Someone who owns a DeepSeek key may want their own quota and no shared admission limits.

The product has no accounts, cloud sync or a way to push a secret to one device. A key typed into
a shared server would be wrong; a key bundled into the APK would be extractable by anyone.

## Decision

Add an **optional, device-only personal key** (BYOK) for DeepSeek:

- The person pastes the key in the installed app under **Privacy → Advanced**. It is stored in
  the app's private DataStore, excluded from the backup whitelist, never logged and never sent
  to today's Worker. It is **not** bundled in the APK and not committed to Git.
- When a valid key is present, the WebView calls https://api.deepseek.com/chat/completions
  directly with fetch (DeepSeek reflects the local origin in CORS; verified). Streaming SSE
  and the same prompts/parsers/verifiers are used, so live translation, structured results,
  deterministic verification, repair and Arabic/German behaviour stay intact.
- The native shell's CSP allows api.deepseek.com only for this mode. The key is not part of the
  service-worker/web CSP because web builds do not offer BYOK.
- If the direct request fails for a network/provider/timeout reason, the app falls back to the
  deployed service; an auth/quota/rate answer from DeepSeek is shown instead of hiding it.
- The default remains server mode. No account, sync or telemetry is added.

## Consequences

- The key is present in the app process memory while a request is in flight; at rest it is in
  app-private storage protected by Android FBE (the same boundary as the archive, see ADR 0008).
  A rooted/forensic device can read it. A future hardening step can wrap it with the Android
  Keystore without changing the user-visible flow.
- Direct mode bypasses today's admission limits; DeepSeek's own account rate limits still apply.
- The server keeps its keys and remains the default for every install without a personal key.
- Provider-facing privacy text is unchanged: the same text is sent to DeepSeek either way.

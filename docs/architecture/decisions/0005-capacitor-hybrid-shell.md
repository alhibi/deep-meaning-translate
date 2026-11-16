# ADR 0005 — Capacitor hybrid shell for Android

Status: accepted · 2026-11-16

## Context

The product is one screen whose identity depends on exact typography, palettes, RTL
composition, streaming states, and prompts that live in TypeScript. The mandate asks for
a real Android app with native storage, native file access and native speech — not a
bookmark wrapper and not a fork.

Two candidates:

1. **Compose rewrite.** Native rendering, best platform feel. Cost: reimplement the whole
   translator, duplicate prompts (forbidden), and maintain two products that drift.
2. **Capacitor hybrid.** Package the existing SPA in a WebView, add Kotlin plugins for
   storage, SAF and TTS, and a native HTTP surface. Cost: WebView performance ceiling and
   Android system-bar/IME polish work.

## Decision

Use Capacitor 8 with the UI bundled in the APK (`webDir: android-web`, origin
`https://localhost`). Kotlin owns durable storage, file import/export and TTS fallback.
Prompts, providers, themes and translation logic stay in one codebase.

## Consequences

- One product, one prompt set, one design; web and Android cannot diverge in behaviour.
- The bridge is the only coupling: typed `PersistencePort` + seven native endpoints.
  Replacing the shell later (Compose or native SDK) does not require rewriting the engine.
- WebView rendering and IME behaviour must be verified per device; the compatibility doc
  records the matrix and the manual checklist.
- The APK contains no provider secret; the network surface is the existing Worker.

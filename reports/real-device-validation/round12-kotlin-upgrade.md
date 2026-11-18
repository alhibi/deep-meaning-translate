# Round 12 — Kotlin 2.3 / KSP 2.3 upgrade (2026-11-18)

This closes TD69: the previous Kotlin 2.1.21 was outside the officially supported window for
Gradle 8.14 and AGP 8.13, and predated the R8 8.13.19 that AGP 8.13.2 bundles (needed for Kotlin
2.3 bytecode).

## Versions

| Tool | Before | After |
| --- | --- | --- |
| Kotlin (KGP) | 2.1.21 | **2.3.21** |
| KSP | 2.1.21-2.0.1 | **2.3.14** |
| AGP | 8.13.0 | **8.13.2** (round 8) |
| Gradle wrapper | 8.14.3 | **8.14.7** (round 8) |
| Room | 2.7.2 | **2.7.2 kept** — its KSP2 codegen still compiles under KSP 2.3.14 |
| JDK | 21 | unchanged |

## Build and tests

- `:app:testDebugUnitTest`: **18/18 pass** (the old `historyTrim` test was replaced by a
  regression test asserting that a new row never deletes the oldest one).
- `:app:assembleDebug` and R8 `:app:assembleRelease` succeed.
- No Room/KSP schema failure; the locale pin in `gradle.properties` was left untouched.

## Device verification (same phone, install over data)

- `install -r` over the existing app: `firstInstallTime` unchanged (2026-11-16 20:42:46).
- Existing draft/result restored through the Kotlin/Room bridge (native snapshot OK).
- Automatic translation of `Neue Zeile` completed **without pressing Enter**.
- Dictation held the microphone for ~5.2 s (AudioWorklet + bridge under the new Kotlin).
- Statistics rendered the archive (16 translations / 995 words).

## Artifact

- `artifacts/today-1.0.8-review-r8-candidate7-kotlin23.apk`
- SHA-256 `d149bf07609050e97af17936a75a43de25479a70a340c576780183c935cad46e`
- Commits: `ce4e01f` (upgrade) and `66954b6` (TD69 marked done).

## Still open

Durability window under MagicOS kill (TD65), adaptive foldable composition (TD61), predictive back
(TD62), the owner's confirmation of the overlay fix, and the push decision (local branch is now
several commits ahead of `origin/main`).

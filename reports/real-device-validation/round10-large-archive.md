# Round 10 — large-archive proof and remaining native work (2026-11-18)

## 1. The archive really is unlimited now (controlled test)

Code/test proof was already in place (no `trim` call exists; contract test guards it), but the
user's complaint was about behaviour, so the limit was exercised directly:

- APK: the installed release candidate5 on `emulator-5556` (API 35, arm64).
- Method: the Room database was pulled as root, **2,105 valid history rows** were inserted
  (`bulk-0` … `bulk-2104`), pushed back under the app's uid, then the app was launched.
- After launch: **2,107 rows** (the two pre-existing rows plus the bulk set) — no trimming.
- A real translation was added through the UI: **2,108 rows**.
- The **oldest row `bulk-0 / Satz 0` was still present after the write**, so no row was dropped
  to make room.

Raw log: `logs/large-archive-test.txt`. Classification: **VERIFIED on the emulator with a
root-injected archive**. The retail HONOR phone runs the same code path (and there is no trim
call left in it), but a 2,000+ row archive was not injected on the phone itself. This is stated
plainly rather than upgraded to a phone claim.

## 2. What this closes

- User complaint (1): local history/statistics no longer lose rows at a 2,000-row ceiling; the
  phone archive is read fully and patched in memory for Statistics instead of being refetched.
- User complaint (3): automatic translation without Enter is fixed and device-verified
  (`captureInput: false`, rounds 8–9).
- User complaint about the repository: merged with `origin/main` (`d25b717`), so the build
  contains the latest GitHub main; 3 commits are local and unpushed.

## 3. Still open (goal remains active)

| Item | State |
| --- | --- |
| TTS first-tap readiness + audio focus (TD67) | Open — needs code change and a device check |
| MagicOS kill durability window (TD65) | Open |
| Adaptive foldable composition (TD61) | Open — design decision needed |
| Predictive back (TD62) | Open — plan before targetSdk 37 |
| Kotlin 2.3.21 + KSP 2.3.14 (TD69) | Open — next build-toolchain task |
| User confirmation of the reload-like overlay | Waiting on the owner |

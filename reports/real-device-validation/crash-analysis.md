# Crash and Log Analysis — Real Device

## Logcat is restricted on this retail MagicOS build (device limitation)

`adb logcat` returns only an opaque, encrypted blob instead of entries:

```
$ adb logcat -g
main: ring buffer is 256 KiB (64 KiB consumed, 0 B readable) ...
$ adb logcat -d | wc -l
1        # the single line is a (HKS)...(HKE) token, not a log entry
```

This is an OEM privacy feature (HONOR "HKS"), not an app or ADB fault. No `FATAL`,
`AndroidRuntime` or `ANR` line can be collected with the standard tool on this device without changing
OEM developer/privacy settings, which the pass did not do.

## Fallbacks actually used

| Tool | What it showed |
| --- | --- |
| `dumpsys activity exit-info today.fluently.app` | **No crash/ANR exits.** Only expected entries: `EXIT_SELF` for the WebView sandbox process, `USER REQUESTED / FORCE STOP` and `REMOVE TASK` from testing. No `CRASH`, `ANR`, `LOW_MEMORY` or `INITIALIZATION_FAILURE` records. |
| `dumpsys dropbox` | 4 entries on the device; none raised by the app during the pass (no crash reports observed). |
| `dumpsys appops` | Used to prove real microphone access during dictation (136 ms before fix, 20.9 s after). |
| In-app states | The app surfaces calm error strings, which were captured instead of stack traces. |
| CDP (debug build only) | WebView console was the only way to see the real error: the CSP block of the AudioWorklet blob module (see `fixes-and-regressions.md`). |

## Stability observed during the pass

- No crash, ANR or process death attributed to the app across: install/update, 5 cold launches, 2 hot
  launches, force-stop/relaunch, theme switch x2, locale switch to German and back, model sheet, language
  sheet, stats page, fold/unfold simulation, airplane-mode failure and retry, dictation start/stop.
- WebView renderer subprocesses exit on force-stop as expected.

## Known limitation to carry forward

Until logcat is enabled on this phone (or a debuggable build is used with CDP), silent JS exceptions
outside the dictation path cannot be observed. This is recorded as a **device limitation**, not as a
passed stability claim. `dumpsys activity exit-info` + `dropbox` remain the crash evidence route.
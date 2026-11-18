# Performance Report — Real Device

Device: HONOR PNM-N49 (Snapdragon class `canoe`, 15.3 GB RAM), Android 17, outer display 1080x2420,
120 Hz-capable. APK: release/R8 candidate2 (debug-signed review). Measurements are single-run unless
stated; they are **OBSERVED**, not a benchmark suite.

## Startup (`am start -W`)

| Run | LaunchState | TotalTime | WaitTime |
| --- | --- | --- | --- |
| Cold #1 | COLD | 332 ms | 334 ms |
| Cold #2 | COLD | 313 ms | 316 ms |
| Cold #3 | COLD | 312 ms | 314 ms |
| Cold after force-stop + data restore | COLD | 323 ms | 325 ms |
| Hot #1 | HOT | 29 ms | 31 ms |
| Hot #2 | HOT | 25 ms | 28 ms |

These are excellent for a Capacitor/WebView app and far below the emulator numbers (2.3–3.1 s on
SwiftShader). The board/doc baseline of ~1.9 s came from an emulator and is not comparable.

## Memory

| Metric | Value |
| --- | --- |
| TOTAL PSS | **111,579 KB (~111.6 MB)** |
| TOTAL RSS | 319,156 KB (~319 MB) |
| Java Heap | 43,484 KB |
| Native Heap PSS | ~27,868 KB |
| Swap PSS | 71 KB |

Measured after several launches, two translations, dictation start/stop and theme/locale toggles; the
process had been running for the whole session. No memory-growth test across a long session was run.

## Frame timing — limitation, not a pass

`dumpsys gfxinfo today.fluently.app` returned **0 frames rendered** after resetting and swiping. The
WebView content is rendered by the sandboxed WebView renderer, so per-package HWUI frame statistics do
not capture its frames. No honest jank/frame-time number can be claimed from this method; measuring it
would need a SurfaceFlinger layer trace/Perfetto or a debug-build CDP trace. This remains **NOT
VERIFIED**.

## Battery / thermal

- At audit: 39% charging via USB, 34.0 C battery, Thermal Status 0 (no throttling), skin ~35 C.
- No sustained-load thermal test was run.

## Notes

- The device was on the charger, so battery-drain figures would be meaningless and are not claimed.
- Startup and memory numbers are from the same build that passed the functional pass, so they describe
  the tested artifact.
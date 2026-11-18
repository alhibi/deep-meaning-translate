# Device Fingerprint — HONOR PNM-N49 (foldable)

Status: **CONNECTED AND VERIFIED** on 2026-11-18. Phase 01 complete.

## Connection

| Item | Value |
| --- | --- |
| ADB serial | `A3SD026522005319` |
| State | `device` (authorized), USB port `1048576X` |
| Host | macOS 27.3, Apple M5, 16 GB, ADB 37.0.1 |
| Screen | awake, unlocked (`isKeyguardShowing=false`) during testing |

## Hardware

| Property | Value |
| --- | --- |
| Manufacturer / brand | HONOR |
| Model | PNM-N49 (product `PNM-N49EEA`, device `HNPNMX`) |
| Platform / hardware | Qualcomm `canoe`, `ro.hardware=qcom` |
| CPU ABI | arm64-v8a (only) |
| RAM | 15,370,928 kB total (~15.3 GB); MemAvailable ~6.5 GB during audit |
| Storage | 457 GB `/data` (233 GB free) |
| GPU | Adreno (`ro.hardware.egl=adreno`, OpenGL ES 3.2) |
| Display 0 (outer) | 1080 x 2420, density 480 (override 408), 30/60/90/120 Hz modes, cutout 62 px at x=509..571, rounded corners 76 px |
| Display 1 (inner) | 2172 x 2352, density 480, 30/60/90/120 Hz, cutout 76 px at x=1588..1664, rounded corners 55 px |
| Form factor | **foldable** (`mIsFoldableDevice=true`); device states FLAT(1), HALF_OPENED(2), CLOSED(4), REAR(8) |
| Sensors | 56 sensors (accelerometer, magnetometer, fusion rotation vector, light, etc.) |
| Battery at audit | 39%, charging via USB, 340 (34.0 C), Li-ion, health good |
| Thermal | Thermal Status 0 (no throttling), skin ~35 C |

## Software

| Property | Value |
| --- | --- |
| Android | **17** (API **37**) |
| Build fingerprint | `HONOR/PNM-N49EEA/HNPNMX:17/HONORPNM-N49/11.0.0.132C431E5:user/release-keys` |
| OEM build | `PNM-N49 11.0.0.132(C431E5)` (MagicOS), incremental `11.0.0.132C431E5` |
| Security patch | **2026-10-01** |
| Locale | `ar-DE-u-nu-latn` (Arabic interface, Latin digits), secondary `de-DE` |
| Dark mode | **yes** (system) |
| Font scale | 1.0 (default) |
| Display size | density override **408** (user changed display size) |
| Network | Wi-Fi + 5G + VoLTE; default network active |
| Keyboard | system Arabic + German layouts (Honor/Gboard-like), full-screen IME with toolbar |
| Battery optimisation | deviceidle whitelist read; app not whitelisted by default |
| Logcat | **restricted**: all buffers report `0 B readable`; only an encrypted `(HKS)...(HKE)` blob is returned — see `crash-analysis.md` |

## Installed app at start of pass

| Package | Version | First install | Signature |
| --- | --- | --- | --- |
| `today.fluently.app` | 1.0.8 (code 9) | 2026-11-16 20:42:46 | debug keystore `02d5b40c…de9a` |
| `today.fluently.app.debug` | 1.0.8-debug | 2026-11-16 | same debug keystore |

The release package was updated in place with the candidate APK (`install -r`); `firstInstallTime`
stayed 2026-11-16 20:42:46, so **no user data was cleared**.

Raw capture: `logs/device-fingerprint.txt` and `logs/device-env.txt`.
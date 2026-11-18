# Real-device QA harness

Thin wrapper over ADB used by the real-device validation pass. It refuses to run unless exactly
one physical device is authorized (`qa.sh fingerprint` prints `BLOCKED` and exits 3 otherwise).

```sh
cd reports/real-device-validation/harness
./qa.sh fingerprint                 # full device/OS fingerprint -> ../logs/device-fingerprint.txt
./qa.sh install ../artifacts/today-1.0.8-review-r8-candidate1.apk   # -r, preserves data
./qa.sh launch                      # am start -W + launch timing
./qa.sh smoke                       # logcat + screenshots + ui dump + env + perf
./qa.sh shot 03-translator
./qa.sh ui 03-translator
./qa.sh logstart typing-ar && ... && ./qa.sh logstop
./qa.sh perf typing 15              # meminfo/gfxinfo/top snapshots
```

It never uninstalls, never clears app data, and never falls back to an emulator.
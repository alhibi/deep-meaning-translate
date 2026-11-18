# Round 13 — launch recording and durability trials (2026-11-18)

## 1. The ‘reload-like overlay’ recorded and analysed

A 11.8 s screen recording covered: Home → force-stop → launch → translator → Home. Frames were
extracted at 4 fps (47 frames) and inspected as a contact sheet plus an average-luminance
timeline.

- Launcher: ~34 luminance; app: ~10.6 (dark theme).
- The only cover is the **Android launch splash with the app icon**, visible for roughly
  **0.4–0.5 s**, then the translator.
- **No white flash, no second cover, no repeated reload** while the app stayed foreground.
- Returning Home does not replay it; no overlay appears on resume.

Conclusion: the expected cold-start splash is not an in-app overlay. The overlay the owner
described most plausibly came from an **Activity recreation** replaying the splash. Round 9
proved that a font-scale config change no longer recreates the activity (same PID/ActivityRecord,
draft intact), so the fix for that path is in place. The recording is the reference evidence if
the owner sees it again.

Evidence: `videos/launch-2026-11-18.mp4`, `videos/launch-2026-11-18-contact.png`,
`logs/launch-and-durability-2026-11-18.txt`.

## 2. Durability window (TD65) tested, not reproduced

Protocol per trial: type 10 characters, press Home, `am kill today.fluently.app`, relaunch, read
the restored draft.

| Trials | Delay Home→kill | Result |
| --- | --- | --- |
| 3 | 200 ms | 10/10 characters restored |
| 4 | none | 10/10 characters restored |

7/7 trials kept the full draft. The theoretical 400 ms debounce + async bridge window did not
lose a keystroke on this phone. No code change was made for TD65; it stays open as an observation
item rather than a proven defect, and changing the write cadence without a reproduction would be
churn.

## 3. Artifact and state

- Installed build unchanged in this round (candidate7 Kotlin 2.3.21), data preserved
  (`firstInstallTime` 2026-11-16 20:42:46).
- Phone returned to the launcher.
- Git: still 7 commits ahead of `origin/main`, nothing pushed.

## 4. Still open

Adaptive foldable composition (TD61), predictive back (TD62), the owner's confirmation of the
overlay, and the push decision.

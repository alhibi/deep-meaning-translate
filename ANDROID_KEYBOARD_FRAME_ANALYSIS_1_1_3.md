# Keyboard frame analysis — 1.1.3 (2026-11-20)

Source: the user's screen recording `SVID_20261120_181302_1.mp4` (1080×2420, 4.69 s, 279 frames,
60 fps) analysed frame by frame.

## What the frames show

- Keyboard opens at frames **57–68** and **199–211**, closes at **121–130** (smooth ~0.2 s).
- At the exact open frame (**57**, and again **200**) the app canvas **collapsed for one frame**: the
  header was clipped and the composer card was ~430 px shorter; frame 58 already showed the
  normal layout. This is the fast "render/jerk" the eye catches.
- The grey circle following the finger is the phone's screen-recorder touch indicator, and the
  pill at the end is the recorder's stop control — neither is the app.
- A one-to-two-frame dark band between the canvas and the sliding keyboard is the exposed window
  strip while `dvh` lags the IME animation; after the animation settles the canvas reaches the
  keyboard edge (verified in the 1.1.3 screenshot).

## Root cause

Two independent mechanisms counted the keyboard once each:

1. Native: Capacitor SystemBars pads the WebView bottom by the IME inset (the WebView resizes).
2. Web: `routes/index.tsx` also wrote `--vvh` from `window.visualViewport.height`, which subtracts
   the IME again, and the canvas used `max-h-[var(--vvh,100dvh)]`.

At keyboard open the double subtraction briefly produced a canvas max-height far below the real
viewport, so the flex column compressed the header and composer for one frame, then the next
`visualViewport` sample restored it.

## Fix

- `src/routes/index.tsx`: the visualViewport/`--vvh` effect returns immediately on native; the
  padded WebView is the single source of viewport height. The browser keeps the visualViewport
  path.
- `adjustNothing` was tried and rejected: the WebView then auto-pans the focused composer when the
  keyboard overlays it, producing large scroll jumps (frame deltas up to 36).

## Verification

- Before (user video): content-change spike at keyboard open **7.79** (mean abs diff, 270×175
  sample of the canvas above the keyboard), i.e. the squash.
- After 1.1.2 fix: same gesture re-recorded — **no spike at keyboard open** (max 1.69 at the tap
  focus change, unrelated); keyboard timing unchanged.
- Final 1.1.3 state: keyboard-open screenshot has the canvas reaching the keyboard edge with no
  clipped header and no squashed composer.
- Release build, debug build, unit tests and `npm run verify` all pass; app installed on the
  HONOR PNM-N49 at `versionCode 14` / `1.1.3`.

## Residual

During the ~200 ms keyboard slide, the window strip behind the canvas can be visible for one or two
frames while `dvh` catches up. Removing it fully requires animating the native insets with
`WindowInsetsAnimationCompat` instead of a single padding jump; tracked for the next pass.

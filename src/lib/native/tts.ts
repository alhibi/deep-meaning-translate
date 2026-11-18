import type { PluginListenerHandle } from "@capacitor/core";
import { asNonThenable } from "./plugin";

/**
 * Android's own text-to-speech, used only when the WebView has no speech synthesis.
 *
 * The cloud voices (Gemini PCM, ElevenLabs timestamped audio) and the device Web Speech
 * path stay first: this branch exists for phones whose WebView reports no
 * `speechSynthesis` at all. It has no word boundaries, so read-along falls back to the
 * start-of-text offset rather than pretending to know where the voice is.
 */

interface NativeTts {
  available(): Promise<{ ready: boolean }>;
  speak(options: { text: string; lang: string; rate: number }): Promise<void>;
  stop(): Promise<void>;
  addListener(event: "start" | "end" | "fail", cb: () => void): Promise<PluginListenerHandle>;
}

let plugin: NativeTts | null = null;
/** There can be only one Android TTS utterance. Keep its cleanup with that utterance. */
let stopActive: (() => void) | null = null;

async function engine(): Promise<NativeTts | null> {
  if (plugin) return plugin;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    // Same Capacitor Proxy trap as the storage plugin: an async function must not resolve
    // with a raw plugin proxy or promise assimilation calls `.then()` and the bridge rejects.
    // Without this wrapper `await engine()` threw and onFail never ran (A2-04).
    plugin = asNonThenable(registerPlugin<NativeTts>("LinguaTts") as object) as NativeTts;
    return plugin;
  } catch {
    return null;
  }
}

export interface NativeSpeakHandlers {
  onStart?: () => void;
  onEnd?: () => void;
  onFail?: (why: "unsupported" | "novoice" | "blocked") => void;
}

/** Returns a stop function; the promise chain never throws into a render. */
export function speakNative(
  text: string,
  lang: string,
  h: NativeSpeakHandlers,
  rate: number,
): () => void {
  let stopped = false;
  let detach = () => undefined;
  const finish = () => {
    detach();
    detach = () => undefined;
    if (stopActive === stop) stopActive = null;
  };
  const stop = () => {
    stopped = true;
    finish();
    void engine().then((p) => p?.stop().catch(() => undefined));
  };
  // Starting a later utterance must retire every callback belonging to the former one.
  stopActive?.();
  stopActive = stop;
  void (async () => {
    const tts = await engine().catch(() => null);
    if (!tts) {
      finish();
      return h.onFail?.("unsupported");
    }
    try {
      // The Android engine initialises asynchronously after load(); a first tap during that
      // window used to fail with "unsupported" and never retry. Wait briefly for readiness
      // (bounded, ~1.8 s) before giving up, and stop waiting the moment the person cancels.
      let ready = await tts.available().catch(() => ({ ready: false }));
      for (let attempt = 0; !ready.ready && attempt < 12 && !stopped; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (stopped) return;
        ready = await tts.available().catch(() => ({ ready: false }));
      }
      if (!ready.ready) {
        finish();
        return h.onFail?.("unsupported");
      }
      if (stopped) return;
      const handles: PluginListenerHandle[] = [];
      handles.push(
        await tts.addListener("start", () => {
          if (!stopped) h.onStart?.();
        }),
      );
      handles.push(
        await tts.addListener("end", () => {
          if (stopped) return;
          finish();
          h.onEnd?.();
        }),
      );
      handles.push(
        await tts.addListener("fail", () => {
          if (stopped) return;
          finish();
          h.onFail?.("blocked");
        }),
      );
      detach = () => {
        for (const handle of handles) void handle.remove();
      };
      // stop() can have run while the three asynchronous listener registrations were
      // resolving. Never leave those late handles attached.
      if (stopped) return finish();
      await tts.speak({ text, lang, rate });
    } catch (error) {
      finish();
      const message = (error as Error)?.message ?? "";
      h.onFail?.(message.includes("language") ? "novoice" : "blocked");
    }
  })();
  return stop;
}

/** True when the native fallback is worth trying (installed app, no Web Speech). */
export function hasNativeVoice(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

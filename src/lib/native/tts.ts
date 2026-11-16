import type { PluginListenerHandle } from "@capacitor/core";

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
let detach: (() => void) | null = null;

async function engine(): Promise<NativeTts | null> {
  if (plugin) return plugin;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    plugin = registerPlugin<NativeTts>("LinguaTts");
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
  const stop = () => {
    stopped = true;
    detach?.();
    detach = null;
    void engine().then((p) => p?.stop().catch(() => undefined));
  };
  void (async () => {
    const tts = await engine();
    if (!tts) return h.onFail?.("unsupported");
    try {
      const ready = await tts.available();
      if (!ready.ready) return h.onFail?.("unsupported");
      if (stopped) return;
      const handles: PluginListenerHandle[] = [];
      handles.push(
        await tts.addListener("start", () => {
          if (!stopped) h.onStart?.();
        }),
      );
      handles.push(
        await tts.addListener("end", () => {
          if (!stopped) h.onEnd?.();
        }),
      );
      handles.push(
        await tts.addListener("fail", () => {
          if (!stopped) h.onFail?.("blocked");
        }),
      );
      detach = () => {
        for (const handle of handles) void handle.remove();
      };
      await tts.speak({ text, lang, rate });
    } catch (error) {
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

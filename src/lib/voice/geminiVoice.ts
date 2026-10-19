import { z } from "zod";

/**
 * Shared, client-safe pieces of the Gemini speech integration (Interactions API,
 * gemini-3.8 TTS family). The server route builds requests with these; the app
 * uses the same lists for the voice picker so both sides always agree.
 */

export const TTS_MODELS = {
  best: "gemini-3.8-flash-tts",
  fast: "gemini-3.8-flash-lite-tts",
} as const;
export type VoiceQuality = keyof typeof TTS_MODELS;

/** The 30 prebuilt studio voices documented for Gemini 3.8 TTS, with their character. */
export const GEMINI_VOICES = [
  ["Kore", "Firm"],
  ["Puck", "Upbeat"],
  ["Charon", "Informative"],
  ["Zephyr", "Bright"],
  ["Fenrir", "Excitable"],
  ["Leda", "Youthful"],
  ["Orus", "Firm"],
  ["Aoede", "Breezy"],
  ["Callirrhoe", "Easy-going"],
  ["Autonoe", "Bright"],
  ["Enceladus", "Breathy"],
  ["Iapetus", "Clear"],
  ["Umbriel", "Easy-going"],
  ["Algieba", "Smooth"],
  ["Despina", "Smooth"],
  ["Erinome", "Clear"],
  ["Algenib", "Gravelly"],
  ["Rasalgethi", "Informative"],
  ["Laomedeia", "Upbeat"],
  ["Achernar", "Soft"],
  ["Alnilam", "Firm"],
  ["Schedar", "Even"],
  ["Gacrux", "Mature"],
  ["Pulcherrima", "Forward"],
  ["Achird", "Friendly"],
  ["Zubenelgenubi", "Casual"],
  ["Vindemiatrix", "Gentle"],
  ["Sadachbia", "Lively"],
  ["Sadaltager", "Knowledgeable"],
  ["Sulafat", "Warm"],
] as const;
export type GeminiVoice = (typeof GEMINI_VOICES)[number][0];
export const VOICE_NAMES = GEMINI_VOICES.map((v) => v[0]) as unknown as [
  GeminiVoice,
  ...GeminiVoice[],
];
export const DEFAULT_VOICE: GeminiVoice = "Kore";

export const PACES = ["slow", "normal", "fast"] as const;
export type Pace = (typeof PACES)[number];

/** Max characters per speech request; the app splits longer text into ordered pieces. */
export const MAX_SPEAK_CHARS = 600;

export const SpeakInput = z.object({
  text: z.string().trim().min(1).max(MAX_SPEAK_CHARS),
  lang: z.string().regex(/^[a-z]{2}$/),
  voice: z.enum(VOICE_NAMES),
  quality: z.enum(["best", "fast"]),
  pace: z.enum(PACES),
});
export type SpeakRequest = z.infer<typeof SpeakInput>;

const LANG_DELIVERY: Record<string, string> = {
  ar: "Arabic, pronounced natively exactly as written (Modern Standard Arabic when the text is formal, the matching spoken dialect when it is colloquial), with correct Arabic phonetics",
  de: "German (Germany), with native Standard German pronunciation, crisp consonants and correct umlauts",
  en: "English (American), with native pronunciation",
  fr: "French (France), with native Parisian pronunciation and proper liaison",
  es: "Spanish (Spain), with native Castilian pronunciation",
  tr: "Turkish, with native pronunciation",
  it: "Italian, with native pronunciation",
  nl: "Dutch (Netherlands), with native pronunciation",
  pt: "Portuguese (Portugal), with native European Portuguese pronunciation",
  ru: "Russian, with native pronunciation and correct word stress",
  fa: "Persian (Iran), with native Farsi pronunciation",
  he: "Hebrew (Israel), with native modern Hebrew pronunciation",
  ur: "Urdu, with native pronunciation",
  zh: "Mandarin Chinese, with native Putonghua pronunciation and accurate tones",
  ja: "Japanese, with native standard Tokyo pronunciation and natural pitch accent",
};

const PACE_STYLE: Record<Pace, string> = {
  slow: "speaking slowly and very clearly, like helping a learner",
  normal: "at a natural, relaxed conversational pace",
  fast: "speaking briskly, like a fluent native in everyday conversation",
};

/** Turn-level delivery instructions (speech_metadata.style), tuned per language and pace. */
export function deliveryStyle(lang: string, pace: Pace): string {
  const l = LANG_DELIVERY[lang] ?? "the language of the text, with native pronunciation";
  return `Read in ${l}; warm, clear and natural, ${PACE_STYLE[pace]}. Read the text verbatim.`;
}

/**
 * Gemini 3.8 TTS treats <…> as performance tags (pauses, sighs). A translation must be
 * read literally, so angle brackets are swapped for look-alike characters.
 */
export function sanitizeTranscript(text: string): string {
  return text.replace(/</g, "‹").replace(/>/g, "›").replace(/\s+/g, " ").trim();
}

export function buildInteraction(req: SpeakRequest, stream = false) {
  return {
    model: TTS_MODELS[req.quality],
    input: [
      {
        type: "user_input",
        content: [
          {
            type: "text",
            text: sanitizeTranscript(req.text),
            annotations: [{ type: "speech_metadata", style: deliveryStyle(req.lang, req.pace) }],
          },
        ],
      },
    ],
    response_format: { type: "audio", mime_type: stream ? "audio/l16" : "audio/wav" },
    generation_config: { speech_config: [{ voice: req.voice }] },
    ...(stream ? { stream: true } : {}),
  };
}

interface InteractionLike {
  steps?: { type?: string; content?: { type?: string; data?: string; mime_type?: string }[] }[];
}

/** The last audio block of the model output, as documented for the REST response. */
export function extractAudio(json: unknown): { data: string; mime: string } | null {
  const steps = (json as InteractionLike)?.steps;
  if (!Array.isArray(steps)) return null;
  let found: { data: string; mime: string } | null = null;
  for (const s of steps) {
    if (s?.type !== "model_output" || !Array.isArray(s.content)) continue;
    for (const c of s.content) {
      if (c?.type === "audio" && typeof c.data === "string" && c.data.length > 0)
        found = { data: c.data, mime: c.mime_type ?? "" };
    }
  }
  return found;
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function isWav(b: Uint8Array): boolean {
  return (
    b.length > 44 &&
    String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === "RIFF" &&
    String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === "WAVE"
  );
}

/** Wrap headerless 16-bit little-endian mono PCM in a RIFF/WAVE container. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(44 + pcm.length));
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i);
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** Playable WAV from whatever the model returned; null when the format is unknown. */
export function normalizeToWav(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): Uint8Array<ArrayBuffer> | null {
  if (isWav(bytes)) return bytes;
  const m = mime.toLowerCase();
  if (m.startsWith("audio/l16") || m.includes("pcm")) {
    const rate = Number(/rate=(\d+)/.exec(m)?.[1] ?? 24000);
    return pcmToWav(bytes, rate);
  }
  return null;
}

export type SpeakErrorKind =
  "input" | "rate" | "config" | "quota" | "provider" | "timeout" | "network";

export function kindForStatus(status: number): SpeakErrorKind {
  if (status === 400) return "input";
  if (status === 401 || status === 403) return "config";
  if (status === 429) return "quota";
  return "provider";
}

/**
 * Incremental SSE reader for streamed Interactions: feed text as it arrives, get back the
 * decoded audio bytes of every complete `step.delta` audio event. Errors surface as `error`.
 */
export function createSseAudioParser() {
  let buf = "";
  return (text: string): { audio: Uint8Array<ArrayBuffer>[]; error?: string; done?: boolean } => {
    buf += text;
    const audio: Uint8Array<ArrayBuffer>[] = [];
    let error: string | undefined;
    let done = false;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      let ev: {
        event_type?: string;
        delta?: { type?: string; data?: string };
        error?: { message?: string };
      };
      try {
        ev = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      if (ev.event_type === "step.delta" && ev.delta?.type === "audio" && ev.delta.data)
        audio.push(base64ToBytes(ev.delta.data));
      else if (ev.event_type === "interaction.completed") done = true;
      else if (ev.event_type === "error" || ev.error) error = ev.error?.message ?? "stream error";
    }
    return error ? { audio, error, done } : { audio, done };
  };
}

/** 16-bit LE PCM → float samples; an odd trailing byte is carried to the next chunk. */
export function pcm16ToFloat(bytes: Uint8Array, carry: number[]): Float32Array {
  const all = carry.length ? new Uint8Array([...carry, ...bytes]) : bytes;
  carry.length = 0;
  const even = all.length - (all.length % 2);
  if (even < all.length) carry.push(all[all.length - 1]!);
  const out = new Float32Array(even / 2);
  const v = new DataView(all.buffer, all.byteOffset, even);
  for (let i = 0; i < out.length; i++) out[i] = v.getInt16(i * 2, true) / 32768;
  return out;
}

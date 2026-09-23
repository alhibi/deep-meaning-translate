import { useCallback, useEffect, useRef, useState } from "react";
import type { MicError } from "./speech";

/* Voice input powered by Gemini transcription: we record clean audio on the device,
 * then the server turns it into text that streams back sentence by sentence.
 * The last recording is kept, so a failed upload can be retried without speaking again. */

const RATE = 16000; // speech-quality mono keeps uploads small (~32 KB/s)
const MAX_SECONDS = 180;

export function encodeWav(chunks: readonly Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((s, c) => s + c.length, 0);
  const buf = new ArrayBuffer(44 + length * 2);
  const v = new DataView(buf);
  const tag = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, "RIFF"); v.setUint32(4, 36 + length * 2, true); tag(8, "WAVE"); tag(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, "data"); v.setUint32(40, length * 2, true);
  let o = 44;
  for (const c of chunks) for (const x of c) { const s = Math.max(-1, Math.min(1, x)); v.setInt16(o, s * (s < 0 ? 32768 : 32767), true); o += 2; }
  return new Blob([buf], { type: "audio/wav" });
}

/** Linear downsample to the speech rate. */
export function downsample(input: Float32Array, from: number, to = RATE): Float32Array {
  if (from <= to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio), end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0; for (let j = start; j < end; j++) sum += input[j]!;
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

/** Read the gateway's SSE stream: deltas append, `done` carries the full transcript. */
export async function readTranscript(res: Response, onDelta: (text: string) => void): Promise<string> {
  if (!res.body) throw new Error("empty");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", acc = "", final: string | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data || data === "[DONE]") continue;
      try {
        const ev = JSON.parse(data) as { type?: string; delta?: string; text?: string; error?: unknown };
        if (ev.error) throw new Error("stream_error");
        if (ev.type === "transcript.text.delta" && ev.delta) { acc += ev.delta; onDelta(acc); }
        else if (ev.type === "transcript.text.done" && typeof ev.text === "string") final = ev.text;
        else if (!ev.type && typeof ev.text === "string") final = ev.text;
      } catch (e) { if ((e as Error).message === "stream_error") throw e; }
    }
  }
  return (final ?? acc).trim();
}

type Perm = "granted" | "denied" | "prompt" | "unknown";

export function useVoice(opts: { lang: string; onText: (text: string, final: boolean) => void; onDone: () => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<MicError>(null);
  const [perm, setPerm] = useState<Perm>("unknown");
  const cb = useRef(opts);
  cb.current = opts;
  const session = useRef<{ stop: () => void } | null>(null);
  const lastFile = useRef<File | null>(null);
  const levelEl = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setSupported(!!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined");
    let status: PermissionStatus | null = null;
    const sync = () => status && setPerm(status.state as Perm);
    navigator.permissions?.query({ name: "microphone" as PermissionName })
      .then((s) => { status = s; sync(); s.addEventListener("change", sync); }).catch(() => {});
    return () => { status?.removeEventListener("change", sync); session.current?.stop(); };
  }, []);
  useEffect(() => { if (perm === "granted" && error === "denied") setError(null); }, [perm, error]);

  const send = useCallback(async (file: File) => {
    setTranscribing(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const lang = cb.current.lang.split("-")[0] ?? "";
      if (lang && lang !== "auto") form.append("language", lang);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      if (!res.ok) throw new Error(String(res.status));
      const text = await readTranscript(res, (t) => cb.current.onText(t, false));
      if (!text) { setError("nospeech"); return; }
      lastFile.current = null;
      cb.current.onText(text, true);
      cb.current.onDone();
    } catch {
      setError("failed"); // the recording is kept; retry re-sends it
    } finally {
      setTranscribing(false);
    }
  }, []);

  const start = useCallback(async () => {
    if (session.current || starting || transcribing) return;
    setError(null);
    setStarting(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      setPerm("granted");
    } catch (e) {
      const n = (e as DOMException)?.name;
      setError(n === "NotAllowedError" || n === "SecurityError" ? "denied" : n === "NotFoundError" ? "nomic" : "failed");
      if (n === "NotAllowedError") setPerm("denied");
      setStarting(false);
      return;
    }
    const ctx = new AudioContext();
    await ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    let samples = 0, peak = 0;
    node.onaudioprocess = (ev) => {
      const d = downsample(new Float32Array(ev.inputBuffer.getChannelData(0)), ctx.sampleRate);
      chunks.push(d); samples += d.length;
      for (let i = 0; i < d.length; i += 8) peak = Math.max(peak, Math.abs(d[i]!));
      if (samples > RATE * MAX_SECONDS) finish();
    };
    src.connect(analyser); src.connect(node); node.connect(ctx.destination);
    // Voice level drives the orb, straight to the DOM (no re-renders).
    const tdata = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const meter = () => {
      analyser.getByteTimeDomainData(tdata);
      let sum = 0; for (const x of tdata) { const s = (x - 128) / 128; sum += s * s; }
      const lvl = Math.min(1, Math.sqrt(sum / tdata.length) * 6);
      levelEl.current?.style.setProperty("--lvl", lvl.toFixed(3));
      raf = requestAnimationFrame(meter);
    };
    meter();
    let ended = false;
    function finish() {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      levelEl.current?.style.setProperty("--lvl", "0");
      node.onaudioprocess = null;
      node.disconnect(); src.disconnect(); analyser.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      session.current = null;
      setListening(false);
      if (samples < RATE * 0.4 || peak < 0.02) { setError("nospeech"); return; }
      const file = new File([encodeWav(chunks, RATE)], "speech.wav", { type: "audio/wav" });
      lastFile.current = file;
      void send(file);
    }
    session.current = { stop: finish };
    setStarting(false);
    setListening(true);
  }, [send, starting, transcribing]);

  const stop = useCallback(() => session.current?.stop(), []);

  return {
    supported, listening, starting, transcribing, error, perm, levelEl,
    start,
    stop,
    /** Re-send the kept recording if the upload failed; otherwise record again. */
    retry: () => (lastFile.current ? void send(lastFile.current) : void start()),
    toggle: () => (session.current ? stop() : void start()),
  };
}

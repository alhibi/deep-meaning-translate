import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { assemblyToken } from "./assembly.functions";
import { ASSEMBLY_LANGUAGES, assemblyText, assemblyUrl } from "./assembly";
import type { MicError } from "./speech";

// AudioWorklet: modern audio thread, real 16kHz signed little-endian PCM, 100ms frames.
const processor = `class DictationPCM extends AudioWorkletProcessor {
 constructor(){super();this.samples=[];this.sum=0;this.count=0;this.position=0;
 this.port.onmessage=()=>{if(this.samples.length){const buf=new ArrayBuffer(3200);const view=new DataView(buf);this.samples.forEach((v,i)=>view.setInt16(i*2,Math.round(v*(v<0?32768:32767)),true));this.port.postMessage(buf,[buf]);this.samples=[];}this.port.postMessage({flushed:true});};}
 process(inputs){const audio=inputs[0]?.[0];if(!audio)return true;
 for(const sample of audio){this.sum+=sample;this.count++;this.position+=16000;
 if(this.position>=sampleRate){this.position-=sampleRate;this.samples.push(Math.max(-1,Math.min(1,this.sum/this.count)));this.sum=0;this.count=0;}
 if(this.samples.length===1600){const buf=new ArrayBuffer(3200);const view=new DataView(buf);this.samples.forEach((v,i)=>view.setInt16(i*2,Math.round(v*(v<0?32768:32767)),true));this.port.postMessage(buf,[buf]);this.samples=[];}}
 return true;}}
 registerProcessor('dictation-pcm',DictationPCM);`;

export function useAssemblySpeech(opts: { lang: string; onText: (text: string, final: boolean) => void; onDone: () => void }) {
  const tokenFn = useServerFn(assemblyToken);
  const cb = useRef(opts); cb.current = opts;
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<MicError>(null);
  const [message, setMessage] = useState<string | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const stopSession = useRef<(() => void) | null>(null);
  const dispose = useRef<(() => void) | null>(null);
  const previous = useRef("");
  useEffect(() => {
    setSupported(!!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined");
    return () => { generation.current++; active.current = false; dispose.current?.(); };
  }, []);

  const start = useCallback(async (resume = false) => {
    if (active.current) return;
    active.current = true;
    const gen = ++generation.current;
    setStarting(true); setError(null); setMessage(null);
    if (!resume) previous.current = "";
    const base = previous.current;
    const turns = new Map<number, string>();
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let ws: WebSocket | null = null;
    let node: AudioWorkletNode | null = null;
    let closing = false;
    let finished = false;
    let flushing = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let shutdown: ReturnType<typeof setTimeout> | undefined;
    const current = () => gen === generation.current;
    const cleanup = () => {
      clearTimeout(timeout); clearTimeout(shutdown);
      stream?.getTracks().forEach(t => t.stop());
      node?.disconnect();
      if (context && context.state !== "closed") void context.close().catch(() => {});
      ws?.close();
    };
    const finish = () => {
      if (finished) return; finished = true;
      cleanup();
      if (!current()) return;
      active.current = false; setStarting(false); setListening(false);
      if (previous.current) { cb.current.onText(previous.current, true); cb.current.onDone(); }
    };
    const fail = (kind: MicError, detail?: string) => {
      if (!current()) { cleanup(); return; }
      setError(kind); setMessage(detail ?? null); finish();
    };
    dispose.current = cleanup;
    const terminate = () => {
      flushing = false;
      stream?.getTracks().forEach(t => t.stop());
      node?.disconnect();
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ForceEndpoint" }));
    };
    stopSession.current = () => {
      if (closing) return;
      closing = true;
      if (ws?.readyState === WebSocket.OPEN) {
        if (node) { flushing = true; node.port.postMessage("flush"); }
        else terminate();
        shutdown = setTimeout(() => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "Terminate" })); finish(); }, 2500);
      } else { generation.current++; finish(); active.current = false; setStarting(false); setListening(false); }
    };
    try {
      const lang = cb.current.lang;
      if (lang !== "auto" && !ASSEMBLY_LANGUAGES.has(lang.split("-")[0] ?? "")) {
        fail("failed", "AssemblyAI does not support this language for live dictation."); return;
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!current() || closing) { cleanup(); return; }
      context = new AudioContext({ sampleRate: 16000 });
      await context.resume();
      if (!current() || closing) { cleanup(); return; }
      const blob = URL.createObjectURL(new Blob([processor], { type: "text/javascript" }));
      try { await context.audioWorklet.addModule(blob); } finally { URL.revokeObjectURL(blob); }
      if (!current() || closing) { cleanup(); return; }
      const session = await tokenFn();
      if (!current() || closing) { cleanup(); return; }
      if (!session.ok) { fail("failed", session.message); return; }
      ws = new WebSocket(assemblyUrl(session.token, lang));
      timeout = setTimeout(() => fail("failed", "AssemblyAI connection timed out."), 20000);
      ws.onmessage = event => {
        if (!current() || finished) return;
        let data; try { data = JSON.parse(event.data); } catch { fail("failed"); return; }
        if (data.type === "Begin" && context && stream && ws) {
          clearTimeout(timeout);
          if (closing) { ws.send(JSON.stringify({ type: "Terminate" })); finish(); return; }
          node = new AudioWorkletNode(context, "dictation-pcm");
          node.port.onmessage = e => {
            if (e.data?.flushed) { if (flushing) terminate(); return; }
            if (current() && (!closing || flushing) && ws?.readyState === WebSocket.OPEN) {
              if (ws.bufferedAmount > 16000 * 2 * 5) { fail("failed", "Connection too slow for live dictation."); return; }
              ws.send(e.data);
            }
          };
          context.createMediaStreamSource(stream).connect(node);
          const silent = context.createGain(); silent.gain.value = 0;
          node.connect(silent); silent.connect(context.destination);
          setStarting(false); setListening(true);
        } else if (data.type === "Turn") {
          const result = assemblyText(turns, data);
          if (!result) { fail("failed"); return; }
          previous.current = [base, result.text].filter(Boolean).join(" ");
          cb.current.onText(previous.current, result.final);
          // Finalized older turns can arrive while the flushed audio is still being
          // processed. Only server Termination or bounded shutdown ends stopping.
        } else if (data.type === "Termination") finish();
        else if (data.type === "Error" || data.error) fail("failed", typeof data.error === "string" ? data.error : "AssemblyAI could not transcribe the audio.");
      };
      ws.onerror = () => fail("failed", "Could not connect to AssemblyAI.");
      ws.onclose = e => { if (!finished && current()) { if (!closing && e.code !== 1000) fail("failed", e.reason || "AssemblyAI session disconnected."); else finish(); } };
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      fail(name === "NotAllowedError" ? "denied" : name === "NotFoundError" ? "nomic" : "failed");
    }
  }, [tokenFn]);
  const stop = useCallback(() => stopSession.current?.(), []);
  const cancel = useCallback(() => {
    generation.current++; active.current = false; dispose.current?.();
    previous.current = ""; setStarting(false); setListening(false);
  }, []);
  return { supported, listening, starting, error, message, start: () => start(), stop, cancel,
    retry: () => start(true), dismiss: () => { setError(null); setMessage(null); },
    toggle: () => active.current ? stop() : void start() };
}
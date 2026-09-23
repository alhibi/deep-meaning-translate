import { describe, expect, it } from "vitest";
import { downsample, encodeWav, readTranscript } from "./voice";

const sse = (s: string) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(s)); c.close(); } }));

describe("voice", () => {
  it("reads streamed deltas and prefers the final text", async () => {
    const seen: string[] = [];
    const text = await readTranscript(
      sse('data: {"type":"transcript.text.delta","delta":"اذهب انت "}\n\ndata: {"type":"transcript.text.delta","delta":"الى المدرسة"}\n\ndata: {"type":"transcript.text.done","text":"اذهب أنت إلى المدرسة."}\n\n'),
      (t) => seen.push(t),
    );
    expect(seen).toEqual(["اذهب انت ", "اذهب انت الى المدرسة"]);
    expect(text).toBe("اذهب أنت إلى المدرسة.");
  });
  it("encodes a valid 16 kHz WAV", () => {
    const b = encodeWav([new Float32Array(1600)], 16000);
    expect(b.size).toBe(44 + 3200);
    expect(b.type).toBe("audio/wav");
  });
  it("downsamples 48k to 16k", () => {
    expect(downsample(new Float32Array(4800), 48000).length).toBe(1600);
  });
});

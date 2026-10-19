import { z } from "zod";

export const ASSEMBLY_MODEL = "universal-3-6-pro";
export const ASSEMBLY_LANGUAGES = new Set("af ar yue ca da nl en et fi fr gl de he hi it ja ko zh mr no nn fa pt ro ru es sv tr ur vi xh zu".split(" "));
export const AssemblyTurn = z.object({
  type: z.literal("Turn"),
  turn_order: z.number().int().nonnegative(),
  transcript: z.string().max(100000),
  end_of_turn: z.boolean(),
});

/** A revised turn replaces itself; distinct turns never lose deliberate repetitions. */
export function assemblyText(turns: Map<number, string>, input: unknown) {
  const parsed = AssemblyTurn.safeParse(input);
  if (!parsed.success) return null;
  turns.set(parsed.data.turn_order, parsed.data.transcript);
  return {
    text: [...turns.entries()].sort(([a], [b]) => a - b).map(([, text]) => text.trim()).filter(Boolean).join(" "),
    final: parsed.data.end_of_turn,
  };
}

export function assemblyUrl(token: string, lang: string) {
  const params = new URLSearchParams({ token, speech_model: ASSEMBLY_MODEL, sample_rate: "16000", encoding: "pcm_s16le", language_detection: "true" });
  const code = lang.split("-")[0];
  if (lang !== "auto" && ASSEMBLY_LANGUAGES.has(code)) params.set("language_codes", JSON.stringify([code]));
  return `wss://streaming.assemblyai.com/v3/ws?${params}`;
}
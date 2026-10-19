import { Check } from "lucide-react";
import { Sheet } from "@/components/stats/Sheet";
import { useI18n, type Key } from "@/lib/i18n";
import { GEMINI_VOICES, PACES } from "@/lib/voice/geminiVoice";
import { setVoicePrefs, useVoicePrefs } from "@/lib/voice/prefs";
import { tick } from "@/lib/haptics";
import { ELEVEN_VOICES } from "@/lib/voice/elevenVoice";
import { VoiceButton } from "@/components/VoiceButton";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-full bg-card p-1">
      {options.map((o) => (
        <VoiceButton
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => {
            onChange(o.v);
            tick();
          }}
          className={`press-soft h-9 flex-1 rounded-full px-3 text-[13px] transition-colors ${
            value === o.v ? "bg-signal text-signal-foreground font-medium" : "text-muted-foreground"
          }`}
        >
          {o.label}
        </VoiceButton>
      ))}
    </div>
  );
}

/** Voice settings: engine, Gemini voice character, quality (model) and speed. Device-only. */
export function VoiceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, rtl } = useI18n();
  const p = useVoicePrefs();
  const gem = p.engine === "gemini";
  const eleven = p.engine === "elevenlabs";
  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={t("voiceSettings")}
      dir={rtl ? "rtl" : "ltr"}
      closeLabel={t("close")}
      title={<h2 className="text-[17px] font-semibold tracking-tight">{t("voiceSettings")}</h2>}
    >
      <div className="space-y-6 pb-4">
        <section className="space-y-2">
          {(["elevenlabs", "gemini", "device"] as const).map((e) => (
            <VoiceButton
              key={e}
              type="button"
              aria-pressed={p.engine === e}
              onClick={() => setVoicePrefs({ engine: e })}
              className="press-soft flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-start"
            >
              <span className="flex-1">
                <span className="block text-[15px] text-foreground">
                  {t(e === "elevenlabs" ? "vEleven" : e === "gemini" ? "vGemini" : "vDevice")}
                </span>
                <span className="block text-[12.5px] text-muted-foreground">
                  {t(e === "elevenlabs" ? "vElevenSub" : e === "gemini" ? "vGeminiSub" : "vDeviceSub")}
                </span>
              </span>
              {p.engine === e ? (
                <Check className="size-4 text-signal-text" strokeWidth={2} />
              ) : null}
            </VoiceButton>
          ))}
        </section>

        <section className="space-y-2">
          <h3 className="text-[12px] uppercase tracking-[0.08em] text-faint">{t("voicePace")}</h3>
          <Segmented
            label={t("voicePace")}
            value={p.pace}
            onChange={(pace) => setVoicePrefs({ pace })}
            options={PACES.map((v) => ({
              v,
              label: t(`pace${v.charAt(0).toUpperCase()}${v.slice(1)}` as Key),
            }))}
          />
        </section>

        {gem || eleven ? (
          <>
            <section className="space-y-2">
              <h3 className="text-[12px] uppercase tracking-[0.08em] text-faint">
                {t("voiceQuality")}
              </h3>
              <Segmented
                label={t("voiceQuality")}
                value={p.quality}
                onChange={(quality) => setVoicePrefs({ quality })}
                options={[
                  { v: "best", label: t("qBest") },
                  { v: "fast", label: t("qFast") },
                ]}
              />
            </section>
            <section className="space-y-2">
              <h3 className="text-[12px] uppercase tracking-[0.08em] text-faint">
                {t("voicePick")}
              </h3>
              <div role="radiogroup" aria-label={t("voicePick")} className="grid grid-cols-2 gap-2">
                {(eleven ? ELEVEN_VOICES : GEMINI_VOICES).map(([name, trait]) => (
                  <VoiceButton
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={(eleven ? p.elevenVoice : p.voice) === name}
                    onClick={() => {
                      if (eleven) setVoicePrefs({ elevenVoice: name });
                      else if (GEMINI_VOICES.some(([v]) => v === name)) setVoicePrefs({ voice: name as typeof p.voice });
                      tick();
                    }}
                    className={`press-soft rounded-xl px-3 py-2 text-start ${
                      (eleven ? p.elevenVoice : p.voice) === name ? "bg-card ring-1 ring-signal" : "bg-card/60"
                    }`}
                  >
                    <span dir="ltr" className="block text-[14px] text-foreground">
                      {eleven ? trait : name}
                    </span>
                    <span dir="ltr" className="block text-[11.5px] text-muted-foreground">
                      {eleven ? "ElevenLabs" : trait}
                    </span>
                  </VoiceButton>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

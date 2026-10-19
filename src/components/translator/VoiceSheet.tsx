import { Check } from "lucide-react";
import { Sheet } from "@/components/stats/Sheet";
import { useI18n, type Key } from "@/lib/i18n";
import { GEMINI_VOICES, PACES } from "@/lib/voice/geminiVoice";
import { setVoicePrefs, useVoicePrefs } from "@/lib/voice/prefs";
import { tick } from "@/lib/haptics";

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
        <button
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
        </button>
      ))}
    </div>
  );
}

/** Voice settings: engine, Gemini voice character, quality (model) and speed. Device-only. */
export function VoiceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, rtl } = useI18n();
  const p = useVoicePrefs();
  const gem = p.engine === "gemini";
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
          {(["gemini", "device"] as const).map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={p.engine === e}
              onClick={() => setVoicePrefs({ engine: e })}
              className="press-soft flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-start"
            >
              <span className="flex-1">
                <span className="block text-[15px] text-foreground">
                  {t(e === "gemini" ? "vGemini" : "vDevice")}
                </span>
                <span className="block text-[12.5px] text-muted-foreground">
                  {t(e === "gemini" ? "vGeminiSub" : "vDeviceSub")}
                </span>
              </span>
              {p.engine === e ? (
                <Check className="size-4 text-signal-text" strokeWidth={2} />
              ) : null}
            </button>
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
              label: t(`pace${v[0]!.toUpperCase()}${v.slice(1)}` as Key),
            }))}
          />
        </section>

        {gem ? (
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
                {GEMINI_VOICES.map(([name, trait]) => (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={p.voice === name}
                    onClick={() => {
                      setVoicePrefs({ voice: name });
                      tick();
                    }}
                    className={`press-soft rounded-xl px-3 py-2 text-start ${
                      p.voice === name ? "bg-card ring-1 ring-signal" : "bg-card/60"
                    }`}
                  >
                    <span dir="ltr" className="block text-[14px] text-foreground">
                      {name}
                    </span>
                    <span dir="ltr" className="block text-[11.5px] text-muted-foreground">
                      {trait}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

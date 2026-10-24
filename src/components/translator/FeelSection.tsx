import { feel } from "@/lib/feel";
import { setFeelPrefs, useFeelPrefs } from "@/lib/feel/prefs";
import { useI18n } from "@/lib/i18n";

/**
 * Touch & sound: the two switches that decide how the app feels in the hand.
 *
 * Two details are deliberate.
 *
 * Sound previews itself the moment it is switched on. A control called "Interface
 * sounds" that you cannot hear until you close the sheet and go looking for something
 * to tap is a control that will never be turned on.
 *
 * The bead moves with `transform` only, never by animating an inset. The motion rules
 * for this app are compositor-only, and a switch is the one control a person may flick
 * repeatedly — exactly where a layout-triggering animation would be felt as lag.
 */
function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  const { rtl } = useI18n();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="press relative h-[26px] w-[46px] shrink-0 rounded-full"
      style={{ backgroundColor: on ? "var(--signal)" : "var(--input)" }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 start-[3px] my-auto size-5 rounded-full bg-card"
        style={{
          // Travel = track 46 − bead 20 − 3px padding each side. The sign flips in RTL
          // because translateX is physical, while the track itself is logical.
          transform: `translateX(${on ? (rtl ? -20 : 20) : 0}px)`,
          transition: "transform 260ms var(--ease-out)",
        }}
      />
    </button>
  );
}

export function FeelSection() {
  const { t } = useI18n();
  const prefs = useFeelPrefs();

  const row = (
    key: "sound" | "haptics",
    label: string,
    sub: string,
    onChange: (next: boolean) => void,
  ) => (
    <div className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] text-foreground">{label}</span>
        <span className="block text-[12.5px] leading-snug text-muted-foreground">{sub}</span>
      </span>
      <Switch on={prefs[key]} onChange={onChange} label={label} />
    </div>
  );

  return (
    <section className="space-y-2">
      <h3 className="text-[12px] uppercase tracking-[0.08em] text-faint">{t("feel")}</h3>
      {row("sound", t("feelSound"), t("feelSoundSub"), (next) => {
        setFeelPrefs({ sound: next });
        // Let them hear what they just chose, in the same gesture that chose it.
        if (next) feel.confirm();
      })}
      {row("haptics", t("feelHaptics"), t("feelHapticsSub"), (next) => {
        setFeelPrefs({ haptics: next });
        if (next) feel.confirm();
      })}
      <p className="px-1 text-[11.5px] leading-snug text-faint">{t("feelReduced")}</p>
    </section>
  );
}

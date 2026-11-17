import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Contrast,
  Globe2,
  Heart,
  Landmark,
  type LucideIcon,
  Music2,
  Smile,
  Split,
  EyeOff,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { segments, type Loss, type ShadowCategory } from "@/lib/translation/shadow";

export const CATEGORY_ICON: Record<ShadowCategory, LucideIcon> = {
  warmth: Heart,
  intensity: Activity,
  respect: Landmark,
  humor: Smile,
  ambiguity: Split,
  culture: Globe2,
  rhythm: Music2,
  implied: EyeOff,
};

/**
 * The shadow itself: an offset, blurred echo of the translation where only the
 * parts that lost meaning carry ink. Sits behind the real text, never in the way.
 */
export function ShadowInk({
  text,
  losses,
  focusId,
  className,
  rtl,
  lang,
}: {
  text: string;
  losses: Loss[];
  focusId: string | null;
  className: string;
  rtl: boolean;
  lang: string;
}) {
  return (
    <p
      aria-hidden
      dir={rtl ? "rtl" : "ltr"}
      lang={lang}
      data-testid="shadow-ink"
      className={`shadow-ink ${rtl ? "shadow-ink-rtl" : ""} ${className}`}
    >
      {segments(text, losses).map((s, i) =>
        s.loss ? (
          <span
            key={i}
            className="shadow-spot"
            data-severity={s.loss.severity}
            data-loss-id={s.loss.id}
            data-focus={focusId === s.loss.id ? "true" : focusId ? "dim" : undefined}
          >
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

/** Invisible twin above the text: the shadowed words become touchable. */
export function ShadowHits({
  text,
  losses,
  focusId,
  className,
  rtl,
  lang,
  onPick,
}: {
  text: string;
  losses: Loss[];
  focusId: string | null;
  className: string;
  rtl: boolean;
  lang: string;
  onPick: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <p dir={rtl ? "rtl" : "ltr"} lang={lang} className={`shadow-hits ${className}`}>
      {segments(text, losses).map((s, i) =>
        s.loss ? (
          <button
            key={i}
            type="button"
            className="shadow-hit"
            data-severity={s.loss.severity}
            data-loss-id={s.loss.id}
            data-focus={focusId === s.loss.id ? "true" : undefined}
            aria-label={`${t("shTitle")} · ${s.loss.kind === "weakened" ? t("shWeakened") : t("shLost")} · ${t(`sc_${s.loss.category}`)} · ${t("shStrength")} ${s.loss.severity}/3 · ${t("shConfidence")} ${s.loss.confidence >= 0.75 ? t("shLikely") : t("shPossible")}`}
            onClick={() => onPick(s.loss!.id)}
          >
            {s.text}
          </button>
        ) : (
          <span key={i} aria-hidden>
            {s.text}
          </span>
        ),
      )}
    </p>
  );
}

/** One quiet line under the translation: what was lost, or honestly nothing. */
export function ShadowSummary({
  status,
  losses,
  onPick,
  onMap,
  undo,
}: {
  status: "loading" | "ready";
  losses: Loss[];
  onPick: (id: string) => void;
  onMap: () => void;
  undo: { onUndo: () => void } | null;
}) {
  const { t } = useI18n();
  const [noneVisible, setNoneVisible] = useState(true);
  const press = useRef<number | null>(null);
  const empty = status === "ready" && losses.length === 0;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (speech, storage, viewport, mount animation)
    setNoneVisible(true);
    if (!empty) return;
    const id = setTimeout(() => setNoneVisible(false), 2600);
    return () => clearTimeout(id);
  }, [empty]);

  if (undo)
    return (
      <div className="shadow-summary animate-fade" role="status">
        <Contrast className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        <span>{t("shApplied")}</span>
        <button
          type="button"
          onClick={undo.onUndo}
          className="press-soft font-medium text-signal-text underline decoration-signal/40 underline-offset-4"
        >
          {t("shUndo")}
        </button>
      </div>
    );
  if (status === "loading")
    return (
      <div className="shadow-summary animate-fade" aria-live="polite">
        <Contrast className="size-3.5 shrink-0 animate-pulse" strokeWidth={1.75} aria-hidden />
        <span>{t("shReading")}</span>
      </div>
    );
  if (empty)
    return (
      <div
        className={`shadow-summary transition-opacity duration-700 ${noneVisible ? "opacity-100" : "opacity-0"}`}
        role="status"
      >
        <span aria-hidden className="shadow-clear" />
        <span>{t("shNone")}</span>
      </div>
    );
  return (
    <div
      className="shadow-summary animate-fade"
      onPointerDown={() => {
        press.current = window.setTimeout(onMap, 550);
      }}
      onPointerUp={() => press.current !== null && clearTimeout(press.current)}
      onPointerLeave={() => press.current !== null && clearTimeout(press.current)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        onClick={onMap}
        className="press-soft inline-flex items-center gap-1.5"
        aria-label={t("shMap")}
      >
        <Contrast className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        <span>{t("shCount").replace("{n}", String(losses.length))}</span>
      </button>
      {losses.map((l) => {
        const Icon = CATEGORY_ICON[l.category];
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => onPick(l.id)}
            className="shadow-chip press-soft"
            data-severity={l.severity}
          >
            <Icon className="size-3" strokeWidth={1.75} aria-hidden />
            {t(`sc_${l.category}`)}
          </button>
        );
      })}
    </div>
  );
}

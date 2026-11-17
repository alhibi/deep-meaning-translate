import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Volume2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { isRtl } from "@/lib/translation/languages";
import type { Loss, Span } from "@/lib/translation/shadow";
import { speakTranslation, stopSpeaking } from "@/lib/tts";
import { getVoicePrefs } from "@/lib/voice/prefs";
import { CATEGORY_ICON } from "./SentenceShadow";

function Shell({
  open,
  label,
  onClose,
  children,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t, rtl } = useI18n();
  const pushed = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0]?.clientY ?? null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
    if (dy > 0) setDrag(dy);
  };

  const onTouchEnd = () => {
    if (drag > 75) onClose();
    setDrag(0);
    startY.current = null;
  };

  useFocusTrap(open, sheetRef);
  useEffect(() => {
    if (!open) return;
    // Map → detail is one sheet session; reuse its entry before deferred cleanup.
    if (exitTimer.current) clearTimeout(exitTimer.current);
    if (window.history.state?.sheet !== "shadow") window.history.pushState({ sheet: "shadow" }, "");
    pushed.current = true;
    const onPop = () => {
      pushed.current = false;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      stopSpeaking();
      if (pushed.current) {
        pushed.current = false;
        exitTimer.current = setTimeout(() => {
          if (!document.querySelector("[data-shadow-shell]")) window.history.back();
        }, 0);
      }
    };
  }, [open, onClose]);
  useFocusTrap(open, sheetRef);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={sheetRef}
      tabIndex={-1}
      data-shadow-shell
      className="fixed inset-0 z-50 outline-none"
      dir={rtl ? "rtl" : "ltr"}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div onClick={onClose} className="animate-sheet-scrim absolute inset-0 bg-background/70" />
      <div
        style={{
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: drag ? "none" : undefined,
        }}
        className="animate-sheet-in absolute inset-x-0 bottom-0 mx-auto flex max-h-[78dvh] w-full max-w-xl flex-col rounded-t-[26px] border-t border-border bg-surface"
      >
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="flex shrink-0 touch-none cursor-grab justify-center py-2.5 active:cursor-grabbing"
        >
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-border-strong" />
        </div>
        <div className="flex shrink-0 items-center justify-between px-5 pb-1 pt-1">
          <h2 className="flex min-w-0 items-center gap-2 truncate text-[15px] font-semibold text-foreground">
            <span aria-hidden className="shadow-clear" />
            {label}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="press grid size-10 place-items-center rounded-full text-muted-foreground"
          >
            <X className="size-[18px]" strokeWidth={1.75} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-2">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Text with one or more marked regions. */
function Marked({
  text,
  marks,
  lang,
  variant,
}: {
  text: string;
  marks: { span: Span; severity: number; n?: number }[];
  lang: string;
  variant: "shadow" | "change";
}) {
  const rtl = isRtl(lang);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  [...marks]
    .sort((a, b) => a.span.start - b.span.start)
    .forEach((m, i) => {
      if (m.span.start < pos) return;
      parts.push(text.slice(pos, m.span.start));
      parts.push(
        <mark
          key={i}
          className={variant === "shadow" ? "shadow-mark" : "shadow-change"}
          data-severity={m.severity}
        >
          {text.slice(m.span.start, m.span.end)}
          {m.n !== undefined ? <sup className="shadow-num">{m.n}</sup> : null}
        </mark>,
      );
      pos = m.span.end;
    });
  parts.push(text.slice(pos));
  return (
    <p
      dir={rtl ? "rtl" : "ltr"}
      lang={lang}
      className={`whitespace-pre-wrap text-start text-[16px] leading-[1.75] text-foreground ${rtl ? "font-arabic" : ""}`}
    >
      {parts}
    </p>
  );
}

function Meter({ severity, confidence }: { severity: number; confidence: number }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
      <span>{t("shLoss")}</span>
      <span className="flex gap-1" aria-label={`${severity}/3`}>
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className="shadow-meter"
            data-on={n <= severity ? "true" : undefined}
            data-severity={severity}
          />
        ))}
      </span>
      <span className="text-faint">· {confidence >= 0.75 ? t("shLikely") : t("shPossible")}</span>
    </div>
  );
}

export function ShadowSheet({
  loss,
  sourceText,
  sourceLang,
  translation,
  targetLang,
  onApply,
  onKeep,
  onClose,
}: {
  loss: Loss | null;
  sourceText: string;
  sourceLang: string;
  translation: string;
  targetLang: string;
  onApply: (loss: Loss, index: number) => void;
  onKeep: (loss: Loss) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [playing, setPlaying] = useState<number | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (speech, storage, viewport, mount animation)
    setPlaying(null);
    return () => stop.current?.();
  }, [loss?.id]);
  const Icon = loss ? CATEGORY_ICON[loss.category] : null;
  const listen = (i: number, text: string) => {
    stop.current?.();
    if (playing === i) return setPlaying(null);
    setPlaying(i);
    const done = () => setPlaying((p) => (p === i ? null : p));
    stop.current = speakTranslation(
      text,
      targetLang,
      { onEnd: done, onFail: done },
      getVoicePrefs(),
    );
  };
  return (
    <Shell open={!!loss} label={t("shTitle")} onClose={onClose}>
      {loss && Icon ? (
        <div className="space-y-5" data-testid="shadow-sheet">
          <div className="space-y-2">
            <span className="shadow-chip" data-severity={loss.severity}>
              <Icon className="size-3" strokeWidth={1.75} aria-hidden />
              {t(`sc_${loss.category}`)}
            </span>
            <p className="text-[11px] uppercase tracking-[0.08em] text-faint">{t("shSource")}</p>
            <Marked
              text={sourceText}
              lang={sourceLang}
              marks={[{ span: loss.source, severity: loss.severity }]}
              variant="shadow"
            />
          </div>
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.08em] text-faint">{t("shWhat")}</p>
            <p dir="auto" className="text-start text-[15px] leading-relaxed text-foreground">
              {loss.explanation}
            </p>
            <Meter severity={loss.severity} confidence={loss.confidence} />
          </div>
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.08em] text-faint">{t("shRestore")}</p>
            {loss.restores.length ? (
              <ul className="space-y-2">
                {loss.restores.map((r, i) => (
                  <li key={r.text} className="rounded-2xl border border-border bg-card p-4">
                    <Marked
                      text={r.text}
                      lang={targetLang}
                      marks={[{ span: r.changed, severity: 2 }]}
                      variant="change"
                    />
                    {r.note ? (
                      <p
                        dir="auto"
                        className="mt-1.5 text-start text-[12.5px] text-muted-foreground"
                      >
                        {r.note}
                      </p>
                    ) : null}
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onApply(loss, i)}
                        className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-signal px-4 text-[13px] font-medium text-signal-foreground"
                      >
                        <Check className="size-3.5" strokeWidth={2} />
                        {t("shApply")}
                      </button>
                      <button
                        type="button"
                        onClick={() => listen(i, r.text)}
                        aria-label={t("listen")}
                        aria-pressed={playing === i}
                        className="press grid size-9 place-items-center rounded-full text-muted-foreground aria-pressed:text-signal-text"
                      >
                        <Volume2
                          className={`size-4 ${playing === i ? "animate-breathe" : ""}`}
                          strokeWidth={1.75}
                        />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">{t("shNoRestore")}</p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => onKeep(loss)}
              className="press-soft text-[13px] text-muted-foreground underline decoration-border-strong underline-offset-4"
            >
              {t("shKeep")}
            </button>
            <span className="text-[11.5px] text-faint">{t("shHint")}</span>
          </div>
          <span className="sr-only">{translation}</span>
        </div>
      ) : null}
    </Shell>
  );
}

/** Whole-sentence view: each lost part numbered in both languages. Read-only, for learning. */
export function ShadowMap({
  open,
  losses,
  sourceText,
  sourceLang,
  translation,
  targetLang,
  onPick,
  onClose,
}: {
  open: boolean;
  losses: Loss[];
  sourceText: string;
  sourceLang: string;
  translation: string;
  targetLang: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Shell open={open} label={t("shMap")} onClose={onClose}>
      <div className="space-y-4" data-testid="shadow-map">
        <Marked
          text={sourceText}
          lang={sourceLang}
          variant="shadow"
          marks={losses.map((l, i) => ({ span: l.source, severity: l.severity, n: i + 1 }))}
        />
        <div className="shadow-bridge" aria-hidden />
        <Marked
          text={translation}
          lang={targetLang}
          variant="shadow"
          marks={losses.map((l, i) => ({ span: l.target, severity: l.severity, n: i + 1 }))}
        />
        <ul className="space-y-1 border-t border-border pt-3">
          {losses.map((l, i) => {
            const Icon = CATEGORY_ICON[l.category];
            return (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => onPick(l.id)}
                  className="press-soft flex w-full items-start gap-3 rounded-xl py-2 text-start"
                >
                  <span className="shadow-num mt-1">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
                      <Icon className="size-3" strokeWidth={1.75} aria-hidden />
                      {t(`sc_${l.category}`)}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] leading-relaxed text-muted-foreground">
                      <bdi dir={isRtl(sourceLang) ? "rtl" : "ltr"}>{l.sourceQuote}</bdi>
                      <span aria-hidden className="text-faint">
                        ↔
                      </span>
                      <bdi dir={isRtl(targetLang) ? "rtl" : "ltr"}>{l.targetQuote}</bdi>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="text-[11.5px] text-faint">{t("shHint")}</p>
      </div>
    </Shell>
  );
}

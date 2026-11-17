import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Volume2, X } from "lucide-react";
import { useI18n, type Key } from "@/lib/i18n";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { isRtl } from "@/lib/translation/languages";
import { wordDiff, type Loss, type Span } from "@/lib/translation/shadow";
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
        className="animate-sheet-in absolute inset-x-0 bottom-0 mx-auto flex max-h-[86dvh] w-full max-w-xl flex-col rounded-t-[26px] border-t border-border bg-surface sm:max-w-3xl"
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

interface Mark {
  span: Span;
  severity: number;
  n?: number;
  label?: string;
  active?: boolean;
}

/**
 * Text with marked regions. On the map the marks are real buttons: a marked source part
 * and its translation counterpart share one number, so clicking either one highlights the
 * other and a keyboard user can step through them. In the detail sheet the same component
 * renders the two texts in full, unclickable, purely as evidence.
 */
function Marked({
  text,
  marks,
  lang,
  variant,
  side,
  onMarkPick,
}: {
  text: string;
  marks: Mark[];
  lang: string;
  variant: "shadow" | "change";
  side?: "source" | "target";
  onMarkPick?: (n: number) => void;
}) {
  const rtl = isRtl(lang);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  const sorted = [...marks].sort((a, b) => a.span.start - b.span.start);
  sorted.forEach((mark, index) => {
    if (mark.span.start < pos || mark.span.end > text.length) return;
    parts.push(text.slice(pos, mark.span.start));
    const content = (
      <>
        {text.slice(mark.span.start, mark.span.end)}
        {mark.n !== undefined ? <sup className="shadow-num">{mark.n}</sup> : null}
      </>
    );
    const active = mark.active === true;
    const className =
      variant === "shadow"
        ? `shadow-mark ${active ? "outline outline-2 outline-signal outline-offset-2" : ""}`
        : `shadow-change ${active ? "outline outline-2 outline-signal outline-offset-2" : ""}`;
    if (onMarkPick && mark.n !== undefined && side) {
      parts.push(
        <button
          key={`${side}-${mark.n}-${index}`}
          type="button"
          id={`shadow-map-${side}-${mark.n}`}
          dir="auto"
          data-side={side}
          data-mark-index={mark.n}
          data-active={active ? "true" : undefined}
          aria-pressed={active}
          aria-label={mark.label}
          aria-controls={`shadow-map-${side === "source" ? "target" : "source"}-${mark.n}`}
          onClick={() => onMarkPick(mark.n!)}
          className={`press-soft ${className} cursor-pointer`}
        >
          {content}
        </button>,
      );
    } else {
      parts.push(
        <mark key={`mark-${index}`} dir="auto" className={className} data-severity={mark.severity}>
          {content}
        </mark>,
      );
    }
    pos = mark.span.end;
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

/** Strength and confidence are two different measures; they are never merged into one. */
function Measures({ severity, confidence }: { severity: number; confidence: number }) {
  const { t } = useI18n();
  return (
    <dl
      data-testid="shadow-measures"
      className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[12px] text-muted-foreground"
    >
      <div className="flex items-center gap-2">
        <dt>{t("shStrength")}</dt>
        <dd className="flex items-center gap-1.5">
          <span className="flex gap-1" aria-hidden>
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className="shadow-meter"
                data-on={n <= severity ? "true" : undefined}
                data-severity={severity}
              />
            ))}
          </span>
          <span>{severity}/3</span>
        </dd>
      </div>
      <div className="flex items-center gap-2">
        <dt>{t("shConfidence")}</dt>
        <dd>
          {confidence >= 0.75 ? t("shLikely") : t("shPossible")}
          <span className="text-faint"> · {Math.round(confidence * 100)}%</span>
        </dd>
      </div>
    </dl>
  );
}

function kindLabelFor(kind: string | undefined, t: (key: Key) => string): string | null {
  if (kind === "loss") return t("shLost");
  if (kind === "weakened") return t("shWeakened");
  // A cached payload from before the kind field existed still renders calmly.
  return null;
}

/** Text around one span; long paragraphs are not repeated in full inside every card. */
function aroundSpan(text: string, span: Span, radius = 90): { text: string; span: Span } {
  if (text.length <= 320) return { text, span };
  const start = Math.max(0, span.start - radius);
  const end = Math.min(text.length, span.end + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return {
    text: `${prefix}${text.slice(start, end)}${suffix}`,
    span: { start: span.start - start + prefix.length, end: span.end - start + prefix.length },
  };
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (speech)
    setPlaying(null);
    return () => stop.current?.();
  }, [loss?.id]);
  const Icon = loss ? CATEGORY_ICON[loss.category] : null;
  const kindLabel = loss ? kindLabelFor(loss.kind, t) : null;
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="shadow-chip" data-severity={loss.severity}>
              <Icon className="size-3" strokeWidth={1.75} aria-hidden />
              {t(`sc_${loss.category}`)}
            </span>
            {kindLabel ? (
              <span className="text-[12.5px] text-muted-foreground">{kindLabel}</span>
            ) : null}
          </div>
          <Measures severity={loss.severity} confidence={loss.confidence} />
          <div className="space-y-2">
            <h3 className="text-[11px] font-normal uppercase tracking-[0.08em] text-faint">
              {t("shOriginal")}
            </h3>
            <Marked
              text={sourceText}
              lang={sourceLang}
              variant="shadow"
              marks={[{ span: loss.source, severity: loss.severity }]}
            />
          </div>
          <div className="space-y-2">
            <h3 className="text-[11px] font-normal uppercase tracking-[0.08em] text-faint">
              {t("shTranslation")}
            </h3>
            <Marked
              text={translation}
              lang={targetLang}
              variant="shadow"
              marks={[{ span: loss.target, severity: loss.severity }]}
            />
          </div>
          <div className="space-y-2">
            <h3 className="text-[11px] font-normal uppercase tracking-[0.08em] text-faint">
              {t("shWhat")}
            </h3>
            <p dir="auto" className="text-start text-[15px] leading-relaxed text-foreground">
              {loss.explanation}
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="text-[11px] font-normal uppercase tracking-[0.08em] text-faint">
              {t("shRestore")}
            </h3>
            {loss.restores.length ? (
              <ul className="space-y-2">
                {loss.restores.map((restore, i) => {
                  const diff = wordDiff(translation, restore.text);
                  const removed = diff.removed;
                  const added = diff.added ?? restore.changed;
                  const before = removed ? aroundSpan(translation, removed) : null;
                  return (
                    <li key={restore.text} className="rounded-2xl border border-border bg-card p-4">
                      <p className="text-[10.5px] uppercase tracking-[0.08em] text-faint">
                        {t("shChange")}
                      </p>
                      {before && removed ? (
                        <p
                          dir={isRtl(targetLang) ? "rtl" : "ltr"}
                          lang={targetLang}
                          className="mt-1 whitespace-pre-wrap text-start text-[13px] leading-relaxed text-muted-foreground"
                        >
                          {before.text.slice(0, before.span.start)}
                          <del className="line-through decoration-1">
                            {before.text.slice(before.span.start, before.span.end)}
                          </del>
                          {before.text.slice(before.span.end)}
                        </p>
                      ) : null}
                      <div className="mt-1.5">
                        <Marked
                          text={restore.text}
                          lang={targetLang}
                          variant="change"
                          marks={[{ span: added, severity: 2 }]}
                        />
                      </div>
                      {restore.note ? (
                        <p
                          dir="auto"
                          className="mt-1.5 text-start text-[12.5px] leading-relaxed text-muted-foreground"
                        >
                          <span className="text-faint">{t("shTradeoff")} · </span>
                          {restore.note}
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
                          onClick={() => listen(i, restore.text)}
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
                  );
                })}
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
        </div>
      ) : null}
    </Shell>
  );
}

/**
 * Whole-text map: the relationship between the two texts is the primary design. Both
 * texts are shown in full with the same numbered marks; a wide screen puts them side by
 * side, a phone stacks them in reading order (original then translation). Clicking a mark
 * highlights its counterpart and scrolls it into view, so the link is visible without
 * losing the place in a long paragraph.
 */
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
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate reset when the map reopens for another sentence
    setActive(null);
  }, [open]);

  const reducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  const reveal = (side: "source" | "target", n: number) => {
    if (typeof document === "undefined") return;
    const element = document.getElementById(`shadow-map-${side}-${n}`);
    if (!element) return;
    element.scrollIntoView?.({
      block: "nearest",
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  };

  const highlight = (n: number, side: "source" | "target") => {
    const next = active === n ? null : n;
    setActive(next);
    if (next !== null) reveal(side === "source" ? "target" : "source", next);
  };

  const labelFor = (loss: Loss, n: number) => {
    const confidence = loss.confidence >= 0.75 ? t("shLikely") : t("shPossible");
    return `${t("shLost")} ${n}: ${t(`sc_${loss.category}`)}, ${t("shStrength")} ${loss.severity}/3, ${t("shConfidence")} ${confidence}`;
  };

  const marksFor = (side: "source" | "target") =>
    losses.map((loss, index) => ({
      span: side === "source" ? loss.source : loss.target,
      severity: loss.severity,
      n: index + 1,
      label: labelFor(loss, index + 1),
      active: active === index + 1,
    }));

  return (
    <Shell open={open} label={t("shMap")} onClose={onClose}>
      <div className="space-y-4" data-testid="shadow-map">
        <div className="grid gap-5 sm:grid-cols-2">
          <section aria-labelledby="shadow-map-source-heading">
            <h3
              id="shadow-map-source-heading"
              className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-faint"
            >
              {t("shOriginal")}
            </h3>
            <Marked
              text={sourceText}
              lang={sourceLang}
              variant="shadow"
              side="source"
              marks={marksFor("source")}
              onMarkPick={(n) => highlight(n, "source")}
            />
          </section>
          <section aria-labelledby="shadow-map-target-heading">
            <h3
              id="shadow-map-target-heading"
              className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-faint"
            >
              {t("shTranslation")}
            </h3>
            <Marked
              text={translation}
              lang={targetLang}
              variant="shadow"
              side="target"
              marks={marksFor("target")}
              onMarkPick={(n) => highlight(n, "target")}
            />
          </section>
        </div>
        <p className="text-[11.5px] leading-relaxed text-faint">{t("shLinkHint")}</p>
        <ul className="space-y-1 border-t border-border pt-3">
          {losses.map((loss, index) => {
            const Icon = CATEGORY_ICON[loss.category];
            const kindLabel = kindLabelFor(loss.kind, t);
            const activeRow = active === index + 1;
            return (
              <li key={loss.id}>
                <button
                  type="button"
                  onClick={() => onPick(loss.id)}
                  aria-pressed={activeRow}
                  className={`press-soft flex w-full items-start gap-3 rounded-xl py-2 text-start ${activeRow ? "bg-card" : ""}`}
                >
                  <span className="shadow-num mt-1">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-foreground">
                      <Icon className="size-3" strokeWidth={1.75} aria-hidden />
                      {t(`sc_${loss.category}`)}
                      {kindLabel ? (
                        <span className="font-normal text-muted-foreground">{kindLabel}</span>
                      ) : null}
                    </span>
                    <span
                      data-testid="shadow-row-measures"
                      className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12px] text-muted-foreground"
                    >
                      <span>
                        {t("shStrength")} {loss.severity}/3
                      </span>
                      <span>
                        {t("shConfidence")}{" "}
                        {loss.confidence >= 0.75 ? t("shLikely") : t("shPossible")}
                      </span>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] leading-relaxed text-muted-foreground">
                      <bdi dir={isRtl(sourceLang) ? "rtl" : "ltr"}>{loss.sourceQuote}</bdi>
                      <span aria-hidden className="text-faint">
                        ↔
                      </span>
                      <bdi dir={isRtl(targetLang) ? "rtl" : "ltr"}>{loss.targetQuote}</bdi>
                    </span>
                    <span
                      dir="auto"
                      className="mt-1 block text-[13px] leading-relaxed text-foreground"
                    >
                      {loss.explanation}
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

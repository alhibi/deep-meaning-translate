import { memo, useEffect, useMemo, useState } from "react";
import { Trash2, X } from "lucide-react";
import { flags, wordsOf, type Flag } from "@/lib/flags";
import { tipsFor, wordStats, type Tip } from "@/lib/flagInsights";
import { isRtl, languageLabel } from "@/lib/translation/languages";
import { useI18n } from "@/lib/i18n";

const COPY = {
  ar: {
    title: "تحسينات الترجمة",
    markHint: "اضغط الكلمات غير الدقيقة (اختياري)",
    submit: "علّمها غير دقيقة",
    words: "الكلمات الأكثر تعليماً",
    tips: "اقتراحات لتحسين تعليمات النموذج",
    tipsNote: "للعرض فقط — لا يتغير شيء تلقائياً.",
    flagged: "الترجمات المعلّمة",
    empty: "لم تعلّم أي ترجمة بعد. اضغط زر «غير دقيق» تحت أي ترجمة لا تعجبك.",
    needMore: "علّم ترجمتين على الأقل لتظهر الاقتراحات.",
    clear: "حذف الكل",
    times: "مرات",
    recurring: "«{w}» عُلّمت {n} مرات. أضف للتعليمات المعنى المقصود لهذه الكلمة ومثالاً صحيحاً لها.",
    short: "{n} من الترجمات المعلّمة كلمات قصيرة. أضف قاعدة: للكلمة المفردة اختر المعنى الأشيع واذكر البدائل.",
    long: "{n} من الترجمات المعلّمة نصوص طويلة. أضف قاعدة: لا تحذف جملاً ولا تدمجها، وحافظ على ترتيب الأفكار.",
    brain: "{n} من الترجمات المعلّمة كتبها {b}. جرّب النموذج الآخر أو شدّد تعليمات هذا النموذج.",
    pair: "{n} ترجمات معلّمة في اتجاه {p}. أضف أمثلة خاصة بهذا الاتجاه إلى التعليمات.",
  },
  en: {
    title: "Translation improvements",
    markHint: "Tap the inaccurate words (optional)",
    submit: "Mark as inaccurate",
    words: "Most-marked words",
    tips: "Suggestions to improve the model instructions",
    tipsNote: "Display only — nothing changes automatically.",
    flagged: "Marked translations",
    empty: "Nothing marked yet. Tap “Inaccurate” under any translation you don’t like.",
    needMore: "Mark at least two translations to see suggestions.",
    clear: "Delete all",
    times: "times",
    recurring: "“{w}” was marked {n} times. Add its intended meaning and a correct example to the instructions.",
    short: "{n} marked translations are short words. Add a rule: for single words pick the most common meaning and list alternatives.",
    long: "{n} marked translations are long texts. Add a rule: never drop or merge sentences; keep the order of ideas.",
    brain: "{n} marked translations were written by {b}. Try the other model or tighten this model’s instructions.",
    pair: "{n} marked translations are {p}. Add examples for this direction to the instructions.",
  },
  de: {
    title: "Übersetzungsverbesserungen",
    markHint: "Ungenaue Wörter antippen (optional)",
    submit: "Als ungenau markieren",
    words: "Am häufigsten markierte Wörter",
    tips: "Vorschläge für bessere Modellanweisungen",
    tipsNote: "Nur Anzeige — nichts ändert sich automatisch.",
    flagged: "Markierte Übersetzungen",
    empty: "Noch nichts markiert. Tippe unter einer Übersetzung auf „Ungenau“.",
    needMore: "Markiere mindestens zwei Übersetzungen, um Vorschläge zu sehen.",
    clear: "Alle löschen",
    times: "Mal",
    recurring: "„{w}“ wurde {n} Mal markiert. Ergänze die gemeinte Bedeutung und ein korrektes Beispiel in den Anweisungen.",
    short: "{n} markierte Übersetzungen sind kurze Wörter. Regel ergänzen: bei Einzelwörtern die häufigste Bedeutung wählen und Alternativen nennen.",
    long: "{n} markierte Übersetzungen sind lange Texte. Regel ergänzen: keine Sätze weglassen oder zusammenlegen, Reihenfolge beibehalten.",
    brain: "{n} markierte Übersetzungen stammen von {b}. Das andere Modell testen oder die Anweisungen verschärfen.",
    pair: "{n} markierte Übersetzungen in Richtung {p}. Beispiele für diese Richtung ergänzen.",
  },
} as const;

const BRAIN: Record<string, string> = { deepseek: "DeepSeek", luna: "Luna" };

export const FlagSheet = memo(function FlagSheet({
  open,
  draft,
  list,
  onClose,
}: {
  open: boolean;
  /** The current translation being marked; null opens the overview only. */
  draft: Omit<Flag, "id" | "createdAt" | "words"> | null;
  list: Flag[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const c = COPY[locale as keyof typeof COPY] ?? COPY.en;
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [sent, setSent] = useState(false);
  useEffect(() => {
    setPicked(new Set());
    setSent(false);
  }, [open, draft?.translated]);

  const words = useMemo(() => wordStats(list).slice(0, 12), [list]);
  const tips = useMemo(() => tipsFor(list), [list]);
  if (!open) return null;

  const tipText = (tip: Tip) => {
    const n = String(tip.count);
    if (tip.kind === "recurring") return c.recurring.replace("{w}", tip.word).replace("{n}", n);
    if (tip.kind === "brain") return c.brain.replace("{b}", BRAIN[tip.brain] ?? tip.brain).replace("{n}", n);
    if (tip.kind === "pair")
      return c.pair.replace("{p}", `${languageLabel(tip.source)} ← ${languageLabel(tip.target)}`).replace("{n}", n);
    return c[tip.kind].replace("{n}", n);
  };

  const draftWords = draft ? wordsOf(draft.translated) : [];
  const rtl = draft ? isRtl(draft.target) : false;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={c.title}
      className="fixed inset-0 z-50 flex flex-col justify-end bg-foreground/20"
    >
      <button type="button" aria-label={t("close")} className="flex-1" onClick={onClose} />
      <div className="animate-rise max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card pad-safe-bottom">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h2 className="text-[14px] font-medium text-foreground">{c.title}</h2>
          <button type="button" onClick={onClose} aria-label={t("close")} className="press grid size-9 place-items-center rounded-full text-muted-foreground">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="space-y-6 px-5 py-4">
          {draft && !sent ? (
            <section>
              <p className="text-[12px] text-muted-foreground">{c.markHint}</p>
              <div dir={rtl ? "rtl" : "ltr"} className="mt-3 flex flex-wrap gap-2">
                {draftWords.map((w, i) => (
                  <button
                    key={`${w}-${i}`}
                    type="button"
                    aria-pressed={picked.has(i)}
                    onClick={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (n.has(i)) n.delete(i);
                        else n.add(i);
                        return n;
                      })
                    }
                    className={`press rounded-full border px-3 py-1.5 text-[15px] transition-colors ${rtl ? "font-arabic" : ""} ${
                      picked.has(i) ? "border-signal bg-signal/15 text-signal-text" : "border-border text-foreground"
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  flags.add({ ...draft, words: [...picked].map((i) => draftWords[i]!) });
                  setSent(true);
                }}
                className="press mt-4 inline-flex h-10 items-center rounded-full bg-signal px-4 text-[13px] font-medium text-signal-foreground"
              >
                {c.submit}
              </button>
            </section>
          ) : null}

          {list.length === 0 ? (
            <p className="text-[14px] leading-relaxed text-muted-foreground">{c.empty}</p>
          ) : (
            <>
              <section>
                <h3 className="text-[11px] uppercase tracking-[0.08em] text-faint">{c.tips}</h3>
                {tips.length ? (
                  <ul className="mt-3 space-y-3">
                    {tips.map((tip, i) => (
                      <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-foreground">
                        <span aria-hidden className="mt-[0.6em] size-1 shrink-0 rotate-45 bg-signal" />
                        <span dir="auto">{tipText(tip)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[13px] text-muted-foreground">{c.needMore}</p>
                )}
                <p className="mt-2 text-[11.5px] text-faint">{c.tipsNote}</p>
              </section>

              {words.length ? (
                <section>
                  <h3 className="text-[11px] uppercase tracking-[0.08em] text-faint">{c.words}</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {words.map((w) => (
                      <span
                        key={`${w.target}-${w.word}`}
                        dir="auto"
                        className={`rounded-full bg-surface px-3 py-1 text-[14px] text-foreground ${isRtl(w.target) ? "font-arabic" : ""}`}
                      >
                        {w.word} <span className="text-[12px] text-faint">×{w.count}</span>
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              <section>
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] uppercase tracking-[0.08em] text-faint">
                    {c.flagged} · {list.length}
                  </h3>
                  <button type="button" onClick={() => flags.clear()} className="press-soft text-[12px] text-muted-foreground">
                    {c.clear}
                  </button>
                </div>
                <ul className="mt-2 divide-y divide-border">
                  {list.map((f) => (
                    <li key={f.id} className="flex items-start gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p dir="auto" className="text-start text-[13px] text-muted-foreground">{f.original}</p>
                        <p dir="auto" className={`mt-1 text-start text-[15px] text-foreground ${isRtl(f.target) ? "font-arabic" : ""}`}>
                          {f.translated}
                        </p>
                        {f.words.length ? (
                          <p dir="auto" className="mt-1 text-start text-[12px] text-signal-text">{f.words.join(" · ")}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => flags.remove(f.id)}
                        aria-label={c.clear}
                        className="press grid size-9 shrink-0 place-items-center rounded-full text-faint"
                      >
                        <Trash2 className="size-4" strokeWidth={1.75} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

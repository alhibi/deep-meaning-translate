import { memo, useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { limitDraft, MAX_DRAFT_LENGTH } from "@/lib/composer";
import { useI18n } from "@/lib/i18n";

/**
 * The native editing surface owns selection, undo, scrolling and IME composition.
 * React mirrors its value; only committed input is bounded or submitted. The native
 * fallback runs after React's onChange, so ordinary input is reconciled exactly once.
 */
export const ComposerField = memo(function ComposerField({
  inputRef,
  value,
  onValueChange,
  onSubmit,
  onPaste,
  onComposingChange,
  rtl,
  lang,
  dictating = false,
  dictationStarting = false,
  children,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onPaste: () => void;
  onComposingChange: (active: boolean) => void;
  rtl: boolean;
  lang?: string | undefined;
  dictating?: boolean;
  /** Lock editing during permission/connection setup, but keep the native draft visible. */
  dictationStarting?: boolean;
  /** Dictation overlay shares the editor's actual content-sized bounds. */
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const composing = useRef(false);
  const latestValue = useRef(value);
  // Event-only latest value; never used to render.
  latestValue.current = value;

  const accept = useCallback(
    (raw: string) => {
      // Truncating a candidate buffer can dismiss or corrupt an Android/CJK IME.
      const next = composing.current ? raw : limitDraft(raw);
      const field = inputRef.current;
      if (!composing.current && raw !== next && field?.value === raw) field.value = next;
      if (next === latestValue.current) return;
      latestValue.current = next;
      onValueChange(next);
    },
    [onValueChange, inputRef],
  );

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    let disposed = false;
    const reconcile = () => {
      queueMicrotask(() => {
        if (!disposed && !composing.current && !field.readOnly) accept(field.value);
      });
    };
    field.addEventListener("input", reconcile);
    return () => {
      disposed = true;
      field.removeEventListener("input", reconcile);
    };
  }, [inputRef, accept]);

  const finishComposition = useCallback(
    (field: HTMLTextAreaElement) => {
      composing.current = false;
      accept(field.value);
      onComposingChange(false);
    },
    [accept, onComposingChange],
  );

  return (
    <>
      <div
        dir={rtl ? "rtl" : "ltr"}
        lang={lang}
        className={`composer-editor relative min-w-0 ${
          rtl ? "font-arabic text-[24px]" : "text-[22px] tracking-[-0.015em]"
        }`}
      >
        {/* Pure CSS intrinsic sizing: no scrollHeight writes or resize feedback. The
            sentinel keeps a trailing newline/empty line as tall as the native field.

            The mirror repeats the field's direction and padding so the two boxes lay the
            same text out in the same lines. It is invisible and cannot paint a caret: the
            only caret on screen is the textarea's own, drawn at the inline-start content
            edge of whatever the browser resolves for the current value. A zero-width
            sentinel is not enough here — if the mirror inherited a different direction,
            its wrapping (and therefore the field's height under a long draft) would drift
            from the text the person is actually editing. */}
        <div aria-hidden="true" dir={rtl ? "rtl" : "ltr"} className="composer-mirror pe-14">
          {`${value}\u200b`}
        </div>
        <textarea
          id="composer"
          ref={inputRef}
          value={value}
          onChange={(event) => accept(event.currentTarget.value)}
          onPaste={(event) => {
            if (!composing.current && event.clipboardData.getData("text/plain")) onPaste();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.altKey) return;
            // Safari/Android may report Enter/229 while confirming an IME candidate.
            if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            if (!event.repeat && !dictating && !dictationStarting)
              onSubmit(limitDraft(event.currentTarget.value));
          }}
          onCompositionStart={() => {
            composing.current = true;
            onComposingChange(true);
          }}
          onCompositionEnd={(event) => finishComposition(event.currentTarget)}
          onBlur={(event) => finishComposition(event.currentTarget)}
          dir={rtl ? "rtl" : "ltr"}
          lang={lang}
          rows={1}
          maxLength={MAX_DRAFT_LENGTH}
          readOnly={dictating || dictationStarting}
          autoCapitalize="sentences"
          autoComplete="off"
          enterKeyHint="done"
          spellCheck
          placeholder={t("placeholder")}
          aria-label={t("inputLabel")}
          aria-describedby="composer-help composer-limit"
          aria-keyshortcuts="Enter Control+Enter Meta+Enter"
          className={`composer-field block w-full resize-none bg-transparent pe-14 outline-none ${
            dictating ? "text-transparent caret-transparent" : ""
          }`}
        />
        {children}
      </div>
      <span id="composer-help" className="sr-only">
        {t("automaticTranslation")}. {t("inputHelp")}
      </span>
      <span id="composer-limit" className="sr-only">
        {t("inputLimit")}
      </span>
      <span className="sr-only" role="status">
        {value.length >= MAX_DRAFT_LENGTH ? t("inputLimitReached") : ""}
      </span>
    </>
  );
});

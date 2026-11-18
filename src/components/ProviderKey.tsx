import { useCallback, useState } from "react";
import { isNativeApp } from "@/lib/native/config";
import { useI18n } from "@/lib/i18n";
import {
  clearProviderKey,
  readProviderKey,
  saveProviderKey,
  validateProviderKey,
} from "@/lib/translation/providerKey";

const COPY = {
  en: {
    title: "Advanced · connect your own Velo key",
    lead: "Optional. When a key is saved on this device, translations go straight from this device to Velo with your own quota: faster, no shared request limits, and the key never reaches today's server. This is the API key from your account with Velo's provider. Leave it empty to use the built-in translation service.",
    label: "Velo API key",
    placeholder: "sk-…",
    save: "Save key",
    clear: "Remove key",
    saved: "Saved on this device. Direct mode is active.",
    removed: "Removed. The built-in translation service will be used.",
    invalid: "That does not look like a valid Velo API key.",
    failed: "The key could not be saved.",
    privacy:
      "The key is kept in this app's private storage, is not included in backups and is never logged.",
    active: "Direct Velo key active",
    inactive: "Using the built-in translation service",
  },
  ar: {
    title: "متقدم · استخدم مفتاح Velo الخاص بك",
    lead: "اختياري. عند حفظ مفتاح على هذا الجهاز تُطلب الترجمات مباشرة من Velo بحصتك الخاصة: أسرع، بلا حدود الطلبات المشتركة، ولا يُرسل المفتاح إلى خادم today إطلاقاً. هذا مفتاح API من حسابك لدى مزوّد Velo. اتركه فارغاً لاستخدام خدمة الترجمة المدمجة.",
    label: "مفتاح Velo",
    placeholder: "sk-…",
    save: "حفظ المفتاح",
    clear: "حذف المفتاح",
    saved: "حُفظ على هذا الجهاز. الوضع المباشر مفعّل.",
    removed: "حُذف. ستُستخدم خدمة الترجمة المدمجة.",
    invalid: "هذا لا يبدو مفتاحاً صالحاً لـVelo.",
    failed: "تعذّر حفظ المفتاح.",
    privacy:
      "يبقى المفتاح في تخزين التطبيق الخاص، ولا يدخل في النسخ الاحتياطية، ولا يُسجَّل أبداً.",
    active: "مفتاح Velo المباشر مفعّل",
    inactive: "تُستخدم خدمة الترجمة المدمجة",
  },
  de: {
    title: "Erweitert · eigener Velo-Schlüssel",
    lead: "Optional. Mit einem auf diesem Gerät gespeicherten Schlüssel werden Übersetzungen direkt beim Anbieter von Velo mit deinem eigenen Kontingent angefragt: schneller, ohne gemeinsame Anfragegrenzen, und der Schlüssel erreicht nie den today-Server. Der Schlüssel stammt aus deinem Konto beim Anbieter hinter Velo. Leer lassen, um den eingebauten Dienst zu nutzen.",
    label: "Velo-API-Schlüssel",
    placeholder: "sk-…",
    save: "Schlüssel speichern",
    clear: "Schlüssel entfernen",
    saved: "Auf diesem Gerät gespeichert. Direktmodus ist aktiv.",
    removed: "Entfernt. Der eingebaute Übersetzungsdienst wird genutzt.",
    invalid: "Das sieht nicht wie ein gültiger Velo-Schlüssel aus.",
    failed: "Der Schlüssel konnte nicht gespeichert werden.",
    privacy:
      "Der Schlüssel bleibt im privaten Speicher der App, ist nicht in Backups enthalten und wird nie protokolliert.",
    active: "Direkter Velo-Schlüssel aktiv",
    inactive: "Eingebauter Übersetzungsdienst aktiv",
  },
} as const;

/** Device-only BYOK controls. Rendered only in the installed Android app. */
export function ProviderKey() {
  const { locale } = useI18n();
  const copy = COPY[locale as keyof typeof COPY] ?? COPY.en;
  const [value, setValue] = useState("");
  const [active, setActive] = useState(() => readProviderKey() !== null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const valid = validateProviderKey(value) !== null;
    if (!valid) {
      setError(copy.invalid);
      setBusy(false);
      return;
    }
    const ok = await saveProviderKey(value).catch(() => false);
    setActive(ok);
    if (ok) {
      setValue("");
      setMessage(copy.saved);
    } else setError(copy.failed);
    setBusy(false);
  }, [copy.failed, copy.invalid, copy.saved, value]);

  const remove = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    await clearProviderKey().catch(() => false);
    setActive(readProviderKey() !== null);
    setMessage(copy.removed);
    setBusy(false);
  }, [copy.removed]);

  if (!isNativeApp()) return null;

  return (
    <section dir={locale === "ar" ? "rtl" : "ltr"} className="mt-10 border-t border-border pt-6">
      <h2 className="text-[17px] font-semibold">{copy.title}</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{copy.lead}</p>
      <p className="mt-2 flex items-center gap-2 text-[12px] text-faint">
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${active ? "bg-success" : "bg-border"}`}
        />
        {active ? copy.active : copy.inactive}
      </p>
      <label
        className="mt-4 block text-[12px] font-medium text-muted-foreground"
        htmlFor="provider-key"
      >
        {copy.label}
      </label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <input
          id="provider-key"
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={copy.placeholder}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          dir="ltr"
          className="min-h-11 min-w-0 flex-1 rounded-full border border-border bg-surface px-4 font-mono text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !value.trim()}
          className="press min-h-11 rounded-full bg-signal px-4 text-[13px] font-medium text-signal-foreground disabled:opacity-50"
        >
          {copy.save}
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy || !active}
          className="press min-h-11 rounded-full border border-border px-4 text-[13px] text-muted-foreground disabled:opacity-50"
        >
          {copy.clear}
        </button>
      </div>
      <p role="status" className="mt-2 text-[12px] text-muted-foreground">
        {message}
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-signal-text">
          {error}
        </p>
      ) : null}
      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">{copy.privacy}</p>
    </section>
  );
}

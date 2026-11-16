import { useCallback, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/lib/i18n";
import { isNativeApp, nativeApiUrl } from "@/lib/native/config";
import {
  diagnosticsText,
  subscribeTransport,
  transportSnapshot,
  type TransportRecord,
} from "@/lib/native/diagnostics";

const COPY = {
  en: {
    title: "Connection diagnostics",
    lead: "Safe metadata about the last translation request: no sentence, key or header is stored. Copy this if a failure needs a report.",
    none: "No request recorded yet.",
    copy: "Copy diagnostics",
    copied: "Copied.",
    service: "Service",
    record: "Last request",
  },
  ar: {
    title: "تشخيص الاتصال",
    lead: "بيانات وصفية آمنة عن آخر طلب ترجمة: لا يُحفظ النص ولا المفتاح ولا الترويسات. انسخها إذا احتاج الفشل إلى تقرير.",
    none: "لم يُسجَّل أي طلب بعد.",
    copy: "نسخ التشخيص",
    copied: "تم النسخ.",
    service: "الخدمة",
    record: "آخر طلب",
  },
  de: {
    title: "Verbindungsdiagnose",
    lead: "Sichere Metadaten der letzten Übersetzungsanfrage: kein Satz, Schlüssel oder Header wird gespeichert. Kopiere sie für einen Fehlerbericht.",
    none: "Noch keine Anfrage aufgezeichnet.",
    copy: "Diagnose kopieren",
    copied: "Kopiert.",
    service: "Dienst",
    record: "Letzte Anfrage",
  },
} as const;

function webViewLabel(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const match = /(?:Chrome|Chromium)\/(\d+)/.exec(ua);
  return match ? `WebView ${match[1]}` : "WebView";
}

function RecordLine({ record }: { record: TransportRecord }) {
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] leading-relaxed">
      <dt className="text-faint">id</dt>
      <dd className="font-mono">{record.id}</dd>
      <dt className="text-faint">transport</dt>
      <dd className="font-mono">{record.transport}</dd>
      <dt className="text-faint">status</dt>
      <dd className="font-mono">
        {record.status ?? "—"} {record.contentType ? `· ${record.contentType}` : ""}
      </dd>
      <dt className="text-faint">stage</dt>
      <dd className="font-mono">
        {record.stage}
        {record.kind ? ` · ${record.kind}` : ""}
      </dd>
      <dt className="text-faint">time</dt>
      <dd className="font-mono">
        {record.durationMs} ms · {record.chunks} chunks · {record.bytes} B
      </dd>
      {record.errorName || record.errorMessage ? (
        <>
          <dt className="text-faint">error</dt>
          <dd className="break-words font-mono">
            {record.errorName ?? ""} {record.errorMessage ?? ""}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

/** Read-only diagnostics, visible only in the installed app's Privacy → Advanced area. */
export function DiagnosticsPanel() {
  const { locale } = useI18n();
  const copy = COPY[locale as keyof typeof COPY] ?? COPY.en;
  const records = useSyncExternalStore(subscribeTransport, transportSnapshot, transportSnapshot);
  const [copied, setCopied] = useState(false);
  // Enrichment (dictionary/shadow) runs after a translation and would otherwise hide the
  // record a person actually wants to report.
  const latest =
    records.find(
      (record) => record.transport === "webview-fetch" || record.transport === "deepseek-direct",
    ) ?? records[0];
  const url = nativeApiUrl("/api/native/v1/translate-stream");

  const copyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(diagnosticsText());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard permission is optional */
    }
  }, []);

  if (!isNativeApp()) return null;

  return (
    <section dir={locale === "ar" ? "rtl" : "ltr"} className="mt-10 border-t border-border pt-6">
      <h2 className="text-[17px] font-semibold">{copy.title}</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{copy.lead}</p>
      <p className="mt-2 break-all font-mono text-[11.5px] text-faint">
        {copy.service}: {url ?? "—"} · {webViewLabel()}
      </p>
      <div className="mt-3 rounded-xl border border-border p-3">
        {latest ? (
          <>
            <p className="text-[11px] uppercase tracking-[0.08em] text-faint">{copy.record}</p>
            <RecordLine record={latest} />
          </>
        ) : (
          <p className="text-[12px] text-faint">{copy.none}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void copyAll()}
        className="press-soft mt-2 min-h-10 rounded-full border border-border px-3 text-[12px] text-muted-foreground"
      >
        {copied ? copy.copied : copy.copy}
      </button>
    </section>
  );
}

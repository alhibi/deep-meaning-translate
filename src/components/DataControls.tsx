import { useCallback, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { port } from "@/lib/persistence";
import type { BackupData, ImportReport } from "@/lib/persistence/contracts";
import {
  backupFilename,
  countOf,
  createBackup,
  downloadBackup,
  parseBackup,
} from "@/lib/persistence/backup";
import { isNativeApp } from "@/lib/native/config";
import { filesPlugin } from "@/lib/native/plugin";
import { platformError } from "@/lib/platform";

/**
 * Device data controls: the only place a backup is created or restored.
 *
 * The web downloads a JSON file; the installed app uses Android's document picker, so
 * neither needs a storage permission. Import shows the counts before it changes anything
 * and offers merge or replace explicitly. A damaged, foreign or future file is refused
 * before a single row is written, and an import that fails leaves the device untouched.
 */
const copy = {
  en: {
    title: "Your data",
    lead: "Export a backup you own, or restore one. The file stays yours: nothing is uploaded, and the app never asks for access to your storage.",
    export: "Export a backup",
    import: "Import a backup",
    password: "Protect the file with a password (optional)",
    passwordHint:
      "A password is asked again when the file is imported. Lose it and the file cannot be opened.",
    reading: "Reading the file…",
    preview: "This file contains",
    history: "archive entries",
    saved: "saved phrases",
    memory: "translation-memory rows",
    settings: "settings",
    mode: "How should it be applied?",
    merge: "Merge with what is here (recommended)",
    mergeHint: "Existing rows win when they are newer; nothing is duplicated.",
    replace: "Replace everything on this device",
    replaceHint:
      "The current archive, phrasebook and settings are removed first. This cannot be undone unless you exported a backup.",
    apply: "Apply",
    cancel: "Cancel",
    done: "Import finished",
    added: "added",
    skipped: "already present",
    reload: "Reload the app",
    badFile: "That file is not a today backup, or it was changed after export.",
    badVersion: "This backup comes from a newer version of the app.",
    needPassword: "This file is protected. Enter its password.",
    unreadable: "The file could not be read.",
    noData: "Nothing to export yet.",
    note: "A backup contains your archive, phrasebook, translation memory, draft and settings. Uninstalling the app or clearing its data in Android settings deletes the device copy — the exported file is the only copy that survives.",
    storage:
      "Device storage could not be opened, so this session is not being saved. Translation still works; reopen the app to try storage again.",
  },
  ar: {
    title: "بياناتك",
    lead: "صدّر نسخة احتياطية تملكها، أو استعد نسخة. الملف يبقى لك: لا يُرفع شيء، والتطبيق لا يطلب صلاحية وصول إلى تخزينك.",
    export: "تصدير نسخة احتياطية",
    import: "استيراد نسخة احتياطية",
    password: "حماية الملف بكلمة مرور (اختياري)",
    passwordHint: "ستُطلب كلمة المرور عند الاستيراد. إن فقدتها فلن يُفتح الملف.",
    reading: "يُقرأ الملف…",
    preview: "يحتوي هذا الملف على",
    history: "سجل ترجمة",
    saved: "عبارة محفوظة",
    memory: "سطر ذاكرة ترجمة",
    settings: "إعداد",
    mode: "كيف يُطبَّق؟",
    merge: "الدمج مع الموجود (الأنسب)",
    mergeHint: "تفوز الصفوف الأحدث، ولا يتكرر شيء.",
    replace: "استبدال كل شيء على هذا الجهاز",
    replaceHint:
      "يُحذف الأرشيف ودفتر العبارات والإعدادات الحالية أولاً. لا يمكن التراجع إلا إذا صدّرت نسخة.",
    apply: "تطبيق",
    cancel: "إلغاء",
    done: "انتهى الاستيراد",
    added: "أُضيف",
    skipped: "موجود مسبقاً",
    reload: "إعادة تحميل التطبيق",
    badFile: "هذا ليس ملف نسخة من today، أو تغيّر بعد التصدير.",
    badVersion: "هذه النسخة من إصدار أحدث من التطبيق.",
    needPassword: "الملف محمي. أدخل كلمة المرور.",
    unreadable: "تعذّر قراءة الملف.",
    noData: "لا يوجد ما يُصدَّر بعد.",
    note: "تحتوي النسخة على الأرشيف ودفتر العبارات وذاكرة الترجمة والمسودة والإعدادات. إلغاء تثبيت التطبيق أو مسح بياناته من إعدادات Android يحذف نسخة الجهاز — الملف المصدَّر هو النسخة الوحيدة الباقية.",
    storage:
      "تعذّر فتح تخزين الجهاز، لذا لا تُحفظ هذه الجلسة. الترجمة تعمل، وأعد فتح التطبيق للمحاولة مرة أخرى.",
  },
  de: {
    title: "Deine Daten",
    lead: "Exportiere eine Sicherung, die dir gehört, oder stelle eine wieder her. Die Datei bleibt bei dir: nichts wird hochgeladen, und die App verlangt keinen Zugriff auf deinen Speicher.",
    export: "Sicherung exportieren",
    import: "Sicherung importieren",
    password: "Datei mit einem Passwort schützen (optional)",
    passwordHint:
      "Das Passwort wird beim Import erneut verlangt. Ist es verloren, lässt sich die Datei nicht öffnen.",
    reading: "Datei wird gelesen…",
    preview: "Diese Datei enthält",
    history: "Archivzeilen",
    saved: "gespeicherte Phrasen",
    memory: "Zeilen im Übersetzungsspeicher",
    settings: "Einstellungen",
    mode: "Wie soll sie angewendet werden?",
    merge: "Mit dem Vorhandenen zusammenführen (empfohlen)",
    mergeHint: "Neuere Zeilen gewinnen; nichts wird doppelt.",
    replace: "Alles auf diesem Gerät ersetzen",
    replaceHint:
      "Archiv, Phrasenbuch und Einstellungen werden zuerst entfernt. Das lässt sich nur rückgängig machen, wenn du vorher exportiert hast.",
    apply: "Anwenden",
    cancel: "Abbrechen",
    done: "Import abgeschlossen",
    added: "hinzugefügt",
    skipped: "bereits vorhanden",
    reload: "App neu laden",
    badFile: "Das ist keine today-Sicherung, oder sie wurde nach dem Export verändert.",
    badVersion: "Diese Sicherung stammt aus einer neueren App-Version.",
    needPassword: "Die Datei ist geschützt. Gib ihr Passwort ein.",
    unreadable: "Die Datei konnte nicht gelesen werden.",
    noData: "Noch nichts zu exportieren.",
    note: "Eine Sicherung enthält Archiv, Phrasenbuch, Übersetzungsspeicher, Entwurf und Einstellungen. Deinstallation oder das Löschen der App-Daten in Android entfernt die Gerätekopie — die exportierte Datei ist die einzige, die bleibt.",
    storage:
      "Der Gerätespeicher ließ sich nicht öffnen; diese Sitzung wird nicht gespeichert. Übersetzen funktioniert weiter — öffne die App neu, um es erneut zu versuchen.",
  },
} as const;

interface Preview {
  data: BackupData;
  counts: ReturnType<typeof countOf>;
  fileName: string;
  encrypted: boolean;
}

export function DataControls() {
  const { locale, rtl } = useI18n();
  const c = copy[locale];
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [pendingName, setPendingName] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportBackup = useCallback(async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const snapshot = await port.snapshot();
      const appVersion = (import.meta.env?.["VITE_APP_VERSION"] as string | undefined) ?? "1.0.0";
      const envelope = await createBackup(snapshot, {
        appVersion,
        ...(password.trim() ? { password: password.trim() } : {}),
      });
      const text = JSON.stringify(envelope, null, 2);
      const name = backupFilename();
      if (isNativeApp()) {
        const plugin = await filesPlugin();
        if (!plugin) throw new Error("files-unavailable");
        const result = await plugin.exportBackup({ filename: name, content: text });
        if (!result.saved) {
          setInfo(null);
          return;
        }
        setInfo(`${c.done}: ${result.name ?? name}`);
      } else {
        downloadBackup(name, text);
        setInfo(name);
      }
    } catch {
      setError(c.noData);
    } finally {
      setBusy(false);
    }
  }, [c, password]);

  const beginImport = async () => {
    setError(null);
    setInfo(null);
    setPreview(null);
    setReport(null);
    if (isNativeApp()) {
      const plugin = await filesPlugin();
      if (!plugin) return setError(c.unreadable);
      const picked = await plugin.pickBackup().catch(() => null);
      if (!picked?.content) return;
      setPendingText(picked.content);
      setPendingName(picked.name ?? "backup.json");
      await inspect(picked.content, picked.name ?? "backup.json", password.trim() || undefined);
      return;
    }
    fileRef.current?.click();
  };

  const inspect = useCallback(
    async (text: string, name: string, pass?: string) => {
      setBusy(true);
      setError(null);
      try {
        const parsed = await parseBackup(text, pass);
        if (!parsed.ok) {
          setError(
            parsed.reason === "version"
              ? c.badVersion
              : parsed.reason === "password"
                ? c.needPassword
                : c.badFile,
          );
          return;
        }
        setPreview({
          data: parsed.data,
          counts: parsed.counts,
          fileName: name,
          encrypted: parsed.envelope.encrypted,
        });
      } catch {
        setError(c.unreadable);
      } finally {
        setBusy(false);
      }
    },
    [c],
  );

  const onFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setBusy(true);
      const text = await file.text().catch(() => "");
      setBusy(false);
      if (!text) return setError(c.unreadable);
      setPendingText(text);
      setPendingName(file.name);
      await inspect(text, file.name, password.trim() || undefined);
    },
    [c, inspect, password],
  );

  const apply = useCallback(
    async (mode: "merge" | "replace") => {
      if (!preview) return;
      setBusy(true);
      setError(null);
      try {
        const result = await port.replaceAll(preview.data, mode);
        setReport(result);
        setPreview(null);
      } catch {
        setError(c.unreadable);
      } finally {
        setBusy(false);
      }
    },
    [preview, c],
  );

  return (
    <section
      dir={rtl ? "rtl" : "ltr"}
      className="mt-10 border-t border-border pt-6"
      aria-labelledby="data-title"
    >
      <h2 id="data-title" className="text-[19px] font-semibold">
        {c.title}
      </h2>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{c.lead}</p>
      {platformError() ? (
        <p
          role="status"
          className="mt-3 rounded-[12px] border border-border bg-surface px-3 py-2 text-[13px] text-muted-foreground"
        >
          {c.storage}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        <label
          className="text-[12px] uppercase tracking-[0.08em] text-faint"
          htmlFor="backup-password"
        >
          {c.password}
        </label>
        <input
          id="backup-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className="min-h-11 w-full rounded-[12px] border border-border bg-surface px-3 text-[15px] text-foreground outline-none focus-visible:border-ring"
        />
        <p className="text-[12px] text-faint">{c.passwordHint}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void exportBackup()}
          disabled={busy}
          className="press min-h-11 rounded-full border border-border bg-surface px-4 text-[14px] text-foreground disabled:opacity-50"
        >
          {c.export}
        </button>
        <button
          type="button"
          onClick={() => void beginImport()}
          disabled={busy}
          className="press min-h-11 rounded-full border border-border bg-surface px-4 text-[14px] text-foreground disabled:opacity-50"
        >
          {c.import}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={onFile}
        />
      </div>

      {busy ? <p className="mt-3 text-[13px] text-muted-foreground">{c.reading}</p> : null}
      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-signal-text">
          {error}
        </p>
      ) : null}
      {info ? <p className="mt-3 break-all text-[13px] text-muted-foreground">{info}</p> : null}

      {preview ? (
        <div className="mt-5 rounded-[16px] border border-border bg-surface p-4">
          <p className="text-[13px] text-faint">{preview.fileName}</p>
          <p className="mt-2 text-[15px] font-medium">{c.preview}</p>
          <ul className="mt-2 space-y-1 text-[14px] text-muted-foreground">
            <li>
              {preview.counts.history} {c.history}
            </li>
            <li>
              {preview.counts.saved} {c.saved}
            </li>
            <li>
              {preview.counts.memory} {c.memory}
            </li>
            <li>
              {preview.counts.settings} {c.settings}
            </li>
          </ul>
          <div className="mt-4 space-y-3">
            <button
              type="button"
              onClick={() => void apply("merge")}
              className="press block w-full rounded-[12px] border border-border px-3 py-3 text-start"
            >
              <span className="block text-[15px] text-foreground">{c.merge}</span>
              <span className="mt-1 block text-[12px] text-faint">{c.mergeHint}</span>
            </button>
            <button
              type="button"
              onClick={() => void apply("replace")}
              className="press block w-full rounded-[12px] border border-border px-3 py-3 text-start"
            >
              <span className="block text-[15px] text-foreground">{c.replace}</span>
              <span className="mt-1 block text-[12px] text-faint">{c.replaceHint}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setPendingText("");
              }}
              className="press-soft min-h-11 text-[14px] text-muted-foreground"
            >
              {c.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {pendingText && !preview && error === c.needPassword ? (
        <button
          type="button"
          onClick={() => void inspect(pendingText, pendingName, password.trim() || undefined)}
          className="press mt-3 min-h-11 rounded-full border border-border px-4 text-[14px]"
        >
          {c.apply}
        </button>
      ) : null}

      {report ? (
        <div className="mt-5 rounded-[16px] border border-border bg-surface p-4 text-[14px]">
          <p className="font-medium">{c.done}</p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            <li>
              {c.history}: {report.added.history} {c.added} · {report.skipped.history} {c.skipped}
            </li>
            <li>
              {c.saved}: {report.added.saved} {c.added} · {report.skipped.saved} {c.skipped}
            </li>
            <li>
              {c.memory}: {report.added.memory} {c.added} · {report.skipped.memory} {c.skipped}
            </li>
          </ul>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="press mt-3 min-h-11 rounded-full border border-border px-4"
          >
            {c.reload}
          </button>
        </div>
      ) : null}

      <p className="mt-5 text-[12px] leading-relaxed text-faint">{c.note}</p>
    </section>
  );
}

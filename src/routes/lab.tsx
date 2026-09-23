import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { translate } from "@/lib/translation/translate.functions";
import { verifyTranslation } from "@/lib/translation/verify";
import type { TranslationResult } from "@/lib/translation/types";

/**
 * Developer-only quality lab. Not linked anywhere and returns 404 outside
 * development, so it never touches the product experience.
 */
export const Route = createFileRoute("/lab")({
  staticData: { sitemap: false },
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: () => ({ meta: [{ title: "Lingua lab" }, { name: "robots", content: "noindex" }] }),
  component: Lab,
});

type Case = { id: string; tag: string; text: string; source: string; target: string };

const CASES: Case[] = [
  {
    id: "literal",
    tag: "Literal",
    text: "Ich habe Tomaten auf den Augen.",
    source: "de",
    target: "ar",
  },
  { id: "idiom-ar", tag: "Idiom", text: "اللي فات مات.", source: "ar", target: "de" },
  {
    id: "slang-de",
    tag: "Slang",
    text: "Digga, das war voll krass, ich feier das.",
    source: "de",
    target: "ar",
  },
  {
    id: "slang-ar",
    tag: "Conversational Arabic",
    text: "والله ما عندي خلق أطلع اليوم، خليها لبكرة.",
    source: "ar",
    target: "de",
  },
  {
    id: "emotion",
    tag: "Emotional",
    text: "Ich vermisse dich mehr, als ich zugeben will.",
    source: "de",
    target: "ar",
  },
  {
    id: "ambiguous",
    tag: "Ambiguous",
    text: "Ich habe die Bank gesehen.",
    source: "de",
    target: "ar",
  },
  {
    id: "incomplete",
    tag: "Incomplete",
    text: "Wenn du morgen Zeit hast, dann",
    source: "de",
    target: "ar",
  },
  {
    id: "mixed",
    tag: "Mixed script",
    text: "Morgen habe ich einen Termin عند الدكتور um 9 Uhr.",
    source: "auto",
    target: "ar",
  },
  {
    id: "facts",
    tag: "Numbers · dates · URLs · names",
    text: "Frau Schneider zahlt am 03.11.2026 genau 1.249,50 € — Details: https://example.com/rechnung",
    source: "de",
    target: "ar",
  },
  {
    id: "formal-de",
    tag: "Formal German",
    text: "Hiermit bitte ich Sie höflich um Rückmeldung bis Freitag.",
    source: "de",
    target: "ar",
  },
  {
    id: "msa",
    tag: "Modern Standard Arabic",
    text: "يسرّنا إبلاغكم بأن طلبكم قد تمت الموافقة عليه.",
    source: "ar",
    target: "de",
  },
  {
    id: "long",
    tag: "Long paragraph",
    text: "Als ich letztes Jahr nach Berlin gezogen bin, kannte ich niemanden. Die ersten Wochen waren schwer, aber meine Nachbarin hat mich jeden Sonntag zum Kaffee eingeladen. Heute ist sie wie Familie für mich, und ich kann mir kaum vorstellen, woanders zu wohnen.",
    source: "de",
    target: "ar",
  },
];

type Run = { result?: TranslationResult; error?: string; ms: number; issues: string[] };

function Lab() {
  const [runs, setRuns] = useState<Record<string, Run[]>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function run(c: Case) {
    setBusy(c.id);
    const t0 = performance.now();
    const res = await translate({
      data: { text: c.text, source: c.source, target: c.target, style: "natural" },
    }).catch(() => ({ ok: false as const, kind: "network" as const }));
    const ms = Math.round(performance.now() - t0);
    const entry: Run = res.ok
      ? {
          result: res.result,
          ms,
          issues: verifyTranslation(
            { text: c.text, source: c.source, target: c.target, style: "natural" },
            res.result,
          ),
        }
      : { error: res.kind, ms, issues: [] };
    setRuns((r) => ({ ...r, [c.id]: [entry, ...(r[c.id] ?? [])].slice(0, 3) }));
    setBusy(null);
  }

  async function runAll() {
    for (const c of CASES) await run(c);
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-8 text-[14px]">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-[26px]">Quality lab</h1>
        <button
          type="button"
          onClick={runAll}
          className="press rounded-full bg-signal px-4 py-2 text-signal-foreground"
        >
          Run all
        </button>
      </div>
      <p className="mb-6 text-muted-foreground">
        Check meaning, fluency, tone, omissions, invented details and literalism. The last three
        runs are kept side by side.
      </p>
      <ul className="space-y-6">
        {CASES.map((c) => (
          <li key={c.id} className="border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {c.tag} · {c.source}→{c.target}
              </span>
              <button
                type="button"
                onClick={() => run(c)}
                disabled={busy !== null}
                className="press-soft text-signal disabled:opacity-40"
              >
                {busy === c.id ? "…" : "Run"}
              </button>
            </div>
            <p dir="auto" className="mt-1 text-start">
              {c.text}
            </p>
            {(runs[c.id] ?? []).map((r, i) => (
              <div
                key={i}
                className={`mt-3 border-s-2 ps-3 ${i === 0 ? "border-signal" : "border-border"}`}
              >
                {r.result ? (
                  <>
                    <p
                      dir="auto"
                      lang={c.target}
                      className={`text-start text-[16px] ${c.target === "ar" ? "font-arabic" : ""}`}
                    >
                      {r.result.translation}
                    </p>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {r.ms} ms · {r.result.tone} · {r.result.formality} · confidence{" "}
                      {r.result.confidence}
                      {r.result.isAmbiguous ? " · ambiguous" : ""}
                    </p>
                    {r.result.alternativeTranslations.length ? (
                      <p dir="auto" className="text-start text-[12px] text-muted-foreground">
                        Alt: {r.result.alternativeTranslations.join(" | ")}
                      </p>
                    ) : null}
                    {r.issues.length ? (
                      <p className="text-[12px] text-warning">Checks: {r.issues.join(", ")}</p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-destructive">Failed: {r.error}</p>
                )}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </main>
  );
}

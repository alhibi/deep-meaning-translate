/**
 * Live Sentence Shadow evaluation against the real model (costs a few cents).
 * Run: bun tests/eval/shadow_eval.ts   — needs DEEPSEEK_API_KEY in the environment.
 * Each case says whether a meaningful loss is EXPECTED ("loss") or the shadow must stay empty ("none").
 */
import { call, deepseekKey } from "../../src/lib/translation/providers/deepseek.server";
import { readShadowReply, SHADOW_SYSTEM, shadowUserPrompt } from "../../src/lib/translation/shadow";

type Case = { text: string; source: string; target: string; style?: string; expect: "loss" | "none" };
const CASES: Case[] = [
  { text: "يا حسرتاه على اللي فات", source: "ar", target: "de", expect: "loss" },
  { text: "إن شاء الله بخلص الشغل بكرا", source: "ar", target: "de", expect: "loss" },
  { text: "براحتك، أنا مش زعلان أبداً", source: "ar", target: "de", expect: "loss" },
  { text: "تسلم إيدك على هالأكلة الطيبة", source: "ar", target: "de", expect: "loss" },
  { text: "حضرتك ممكن تساعدني بهالورقة؟", source: "ar", target: "de", expect: "loss" },
  { text: "يا روحي اشتقتلك كتير", source: "ar", target: "de", expect: "loss" },
  { text: "شاطر! كسرت الكاسة التالتة اليوم", source: "ar", target: "de", expect: "loss" },
  { text: "اللي بيته من قزاز ما بيرمي الناس بحجار", source: "ar", target: "de", expect: "loss" },
  { text: "الله يرحم أبوك، كان رجال طيب", source: "ar", target: "de", expect: "loss" },
  { text: "على راسي، طلبك أمر", source: "ar", target: "de", expect: "loss" },
  { text: "ولا يهمك، الدنيا ما طارت", source: "ar", target: "de", expect: "loss" },
  { text: "Na, du alter Schlawiner, wie läuft's?", source: "de", target: "ar", expect: "loss" },
  { text: "Das ist nicht mein Bier, ehrlich gesagt", source: "de", target: "ar", expect: "loss" },
  { text: "Ich drücke dir ganz fest die Daumen", source: "de", target: "ar", expect: "none" },
  { text: "Sie haben das wirklich ganz toll gemacht, Frau Müller", source: "de", target: "ar", style: "casual", expect: "loss" },
  { text: "Morgenstund hat Gold im Mund", source: "de", target: "ar", expect: "loss" },
  { text: "Super, jetzt regnet es auch noch. Genau mein Tag.", source: "de", target: "ar", expect: "loss" },
  { text: "Mir ist das alles einfach zu viel gerade", source: "de", target: "ar", expect: "none" },
  { text: "Kannst du mir bitte das Salz geben?", source: "de", target: "ar", expect: "none" },
  { text: "Der Zug fährt um acht Uhr ab", source: "de", target: "ar", expect: "none" },
  { text: "Ich habe morgen einen Termin beim Arzt", source: "de", target: "ar", expect: "none" },
  { text: "Die Wohnung hat drei Zimmer und einen Balkon", source: "de", target: "ar", expect: "none" },
  { text: "Bitte schicken Sie mir die Rechnung per E-Mail", source: "de", target: "ar", expect: "none" },
  { text: "القطار يغادر الساعة الثامنة صباحاً", source: "ar", target: "de", expect: "none" },
  { text: "أريد أن أفتح حساباً في البنك", source: "ar", target: "de", expect: "none" },
  { text: "الاجتماع غداً في الساعة العاشرة", source: "ar", target: "de", expect: "none" },
  { text: "هل يمكنك أن ترسل لي العنوان؟", source: "ar", target: "de", expect: "none" },
  { text: "أنا أدرس اللغة الألمانية منذ سنتين", source: "ar", target: "de", expect: "none" },
  { text: "الطقس اليوم بارد قليلاً", source: "ar", target: "de", expect: "none" },
  { text: "لقد وصلت الطلبية أمس بحالة جيدة", source: "ar", target: "de", expect: "none" },
];

const key = deepseekKey();
if (!key) throw new Error("DEEPSEEK_API_KEY missing");
let correct = 0, falseFlag = 0, missed = 0;
for (const c of CASES) {
  const style = c.style ?? "natural";
  const tr = await call(
    key,
    `You are a professional ${c.source}→${c.target} translator. Translate the meaning naturally in a ${style} style. Return JSON {"t":"..."}.`,
    c.text,
  );
  let translation = "";
  try {
    translation = String(JSON.parse(tr.slice(tr.indexOf("{"), tr.lastIndexOf("}") + 1)).t ?? "").trim();
  } catch {
    translation = tr.replace(/^[\s\S]*?"t"\s*:\s*"/, "").replace(/"\s*}\s*$/, "").trim();
  }
  if (!translation) {
    console.log(`SKIP (no translation) ${c.text}`);
    continue;
  }
  const raw = await call(
    key,
    SHADOW_SYSTEM,
    shadowUserPrompt({ text: c.text, translation, source: c.source, target: c.target, style, uiLocale: "ar" }),
  );
  const r = readShadowReply(raw, c.text, translation);
  const got = r && r.losses.length ? "loss" : "none";
  if (got === c.expect) correct++;
  else if (got === "loss") falseFlag++;
  else missed++;
  console.log(
    `${got === c.expect ? "OK  " : "MISS"} [${c.expect}→${got}] ${c.text} ⇒ ${translation}` +
      (r?.losses.length ? `\n      ${r.losses.map((l) => `${l.category}/${l.severity} «${l.targetQuote}» ${l.restores.length}r`).join(" | ")}` : ""),
  );
}
console.log(`\nRESULT ${correct}/${CASES.length} correct · ${falseFlag} incorrectly flagged · ${missed} missed`);

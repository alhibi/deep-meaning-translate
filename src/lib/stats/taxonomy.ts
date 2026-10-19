/**
 * Central taxonomy for Translation Statistics. Four independent dimensions —
 * a sentence about work can be a request or a complaint, casual or formal.
 * Every category owns ONE colour token for the whole app (charts, lists, chips).
 * Adding a category = one line here + one label per locale in labels.ts.
 */

export const KINDS = ["word", "phrase", "sentence", "text", "idiom", "slang", "proverb"] as const;
export const DOMAINS = [
  "daily",
  "work",
  "study",
  "social",
  "feelings",
  "travel",
  "shopping",
  "food",
  "services",
  "tech",
  "health",
  "culture",
] as const;
export const INTENTS = [
  "greet",
  "ask",
  "request",
  "thank",
  "apologize",
  "feel",
  "praise",
  "complain",
  "agree",
  "describe",
  "humor",
] as const;
export const REGISTERS = ["natural", "casual", "formal", "colloquial", "idiomatic"] as const;

export type Kind = (typeof KINDS)[number];
export type Domain = (typeof DOMAINS)[number] | "none";
export type Intent = (typeof INTENTS)[number] | "none";
export type Register = (typeof REGISTERS)[number];

export type Dimension = "kind" | "domain" | "intent" | "register";
export const DIMENSION_VALUES: Record<Dimension, readonly string[]> = {
  kind: KINDS,
  domain: [...DOMAINS, "none"],
  intent: [...INTENTS, "none"],
  register: REGISTERS,
};

export const isKind = (v: unknown): v is Kind => KINDS.includes(v as Kind);
export const isDomain = (v: unknown): v is Domain =>
  v === "none" || DOMAINS.includes(v as (typeof DOMAINS)[number]);
export const isIntent = (v: unknown): v is Intent =>
  v === "none" || INTENTS.includes(v as (typeof INTENTS)[number]);
export const isRegister = (v: unknown): v is Register => REGISTERS.includes(v as Register);
export const isDimensionValue = (d: Dimension, v: unknown): boolean =>
  typeof v === "string" && DIMENSION_VALUES[d].includes(v);

/** Colour tokens live in styles.css as --cat-1 … --cat-12 (+ --cat-none), themed for dark and light. */
const C = (n: number) => `var(--cat-${n})`;
export const NONE_COLOR = "var(--cat-none)";

const COLORS: Record<Dimension, Record<string, string>> = {
  kind: {
    word: C(2),
    phrase: C(7),
    sentence: C(1),
    text: C(8),
    idiom: C(4),
    slang: C(6),
    proverb: C(5),
  },
  domain: {
    daily: C(1),
    work: C(2),
    study: C(5),
    social: C(6),
    feelings: C(4),
    travel: C(7),
    shopping: C(3),
    food: C(8),
    services: C(9),
    tech: C(10),
    health: C(11),
    culture: C(12),
    none: NONE_COLOR,
  },
  intent: {
    greet: C(1),
    ask: C(2),
    request: C(7),
    thank: C(3),
    apologize: C(8),
    feel: C(4),
    praise: C(5),
    complain: C(6),
    agree: C(9),
    describe: C(11),
    humor: C(10),
    none: NONE_COLOR,
  },
  register: {
    natural: C(3),
    casual: C(7),
    formal: C(2),
    colloquial: C(6),
    idiomatic: C(4),
  },
};

export function colorOf(dim: Dimension, value: string): string {
  return COLORS[dim][value] ?? NONE_COLOR;
}

/**
 * Language pairs keep one colour everywhere. The app's core directions have fixed,
 * clearly different hues; any other pair gets a stable hue from the remaining set.
 */
const PAIR_COLORS: Record<string, number> = {
  "de>ar": 1,
  "ar>de": 2,
  "en>de": 3,
  "de>en": 4,
  "en>ar": 5,
  "ar>en": 6,
  "auto>de": 8,
  "auto>ar": 7,
};
export function pairColor(pair: string): string {
  const fixed = PAIR_COLORS[pair];
  if (fixed) return C(fixed);
  let h = 2166136261;
  for (let i = 0; i < pair.length; i++) h = Math.imul(h ^ pair.charCodeAt(i), 16777619) >>> 0;
  return C(7 + (h % 6));
}
export const OTHERS_COLOR = "var(--cat-none)";

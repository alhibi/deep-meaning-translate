/** Shape of the versioned Arabic ⇄ German evaluation corpus under tests/eval/corpus/. */

export type Direction = "ar→de" | "de→ar";

export type EvalCategory =
  | "everyday-chat"
  | "workplace"
  | "official"
  | "formal"
  | "casual"
  | "levantine"
  | "msa"
  | "idioms-culture"
  | "sarcasm-implied"
  | "negation-ambiguity"
  | "technical"
  | "facts-numbers"
  | "long-paragraph";

export type EvalStyle = "natural" | "formal" | "casual";

/** Arabic variety requested for Arabic output (`auto` follows the source). */
export type EvalDialect = "auto" | "msa" | "levant";

/** One deterministic requirement: at least one of `any` must appear in the output. */
export interface TermInvariant {
  id: string;
  any: string[];
  /** Why this is safe to check deterministically (shown in failure output). */
  note: string;
}

/** Hand-authored deterministic expectations. Never derived from a model output. */
export interface EvalInvariants {
  /** Canonical facts that must survive: dates as d-m-y, times as h:mm, numbers as values. */
  numbers?: string[];
  /** Exact URLs / emails that must appear byte-for-byte. */
  urls?: string[];
  /** Exact emoji that must survive. */
  emojis?: string[];
  /** Terminology the translation must use (at least one alternative). */
  requiredTerms?: TermInvariant[];
  /** Wording that must NOT leak into this register/variety. */
  forbiddenTerms?: TermInvariant[];
  /** The source negates; the target must keep a negation. */
  negation?: "keep";
  /** The source asks a question; the target must keep a question mark. */
  questionMark?: boolean;
  /** Number of source paragraph blocks (blank-line separated) the answer must mirror. */
  paragraphs?: number;
  /** Soft signal: at least one register marker is expected (not a pass/fail gate). */
  registerMarkers?: TermInvariant;
  /** Soft signal: the requested Arabic variety should surface (not a pass/fail gate). */
  dialectMarkers?: TermInvariant;
  /** Soft signal: the model should flag genuine ambiguity instead of inventing one reading. */
  expectAmbiguous?: boolean;
  /** Soft signal for the judge: sarcasm/implied meaning is the point of this case. */
  expectSarcasm?: boolean;
}

/**
 * Human linguistic review is NOT_VERIFIED in this environment: no native reviewer ran.
 * The slot is data, not a comment, so a reviewer must fill it rather than assume it.
 */
export interface HumanReviewSlot {
  status: "NOT_VERIFIED" | "REVIEWED";
  reviewer: string | null;
  reviewedAt: string | null;
  /** One-to-three things this row is meant to prove to a human. */
  focus: string;
}

export interface EvalCase {
  id: string;
  direction: Direction;
  category: EvalCategory;
  context: "chat" | "work" | "official" | "general";
  style: EvalStyle;
  /** Only for de→ar rows; omitted when German is the target. */
  dialect?: EvalDialect;
  source: string;
  invariants: EvalInvariants;
  humanReview: HumanReviewSlot;
}

export interface CorpusVersion {
  /** Semantic version of the corpus as a whole; bump on any content change. */
  version: string;
  createdAt: string;
  /** Official docs check behind the capabilities the corpus exercises. */
  verifiedAgainst: { model: string; docsAccessedAt: string; urls: string[] };
  cases: EvalCase[];
}

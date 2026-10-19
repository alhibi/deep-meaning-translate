export type StyleOverride = "natural" | "formal" | "casual";

export type Dialect = "auto" | "msa" | "levant" | "egypt" | "gulf" | "iraq" | "maghreb";
export type Brain = "deepseek" | "luna";
export const DEFAULT_BRAIN: Brain = "deepseek";
/** Luna is paused ("soon"): every request runs on DeepSeek, with no Luna fallback. */
export const LUNA_ENABLED = false;
/** The brain that actually writes, whatever an old saved preference asked for. */
export const effectiveBrain = (b?: Brain): Brain => (LUNA_ENABLED ? (b ?? DEFAULT_BRAIN) : "deepseek");
export type Situation = "chat" | "work" | "official" | "general";

export interface TranslationRequest {
  text: string;
  /** BCP-ish short code, or "auto" for detection */
  source: string;
  target: string;
  style: StyleOverride;
  /** Arabic variety for Arabic output; "auto" follows the source. */
  dialect?: Dialect;
  /** Which model writes the translation; the other is the automatic backup. */
  brain?: Brain;
  /** Text still being typed: translate provisionally, skip the repair pass. */
  partial?: boolean;
}

/** Optional classification the model returns with a finished sentence (feeds Translation Statistics). */
export interface ResultTags {
  kind?: string;
  domain?: string;
  intent?: string;
}

export interface TranslationResult {
  sourceLanguage: string;
  targetLanguage: string;
  translation: string;
  tone: string;
  formality: string;
  confidence: number;
  isAmbiguous: boolean;
  alternativeTranslations: string[];
  notes: string;
  /** What kind of text this is — drives the quiet style suggestion. */
  situation?: Situation;
  /** Validated against the statistics taxonomy; absent when the model gave nothing usable. */
  tags?: ResultTags;
}

export interface TranslationProvider {
  id: string;
  translate(req: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult>;
  /** Second pass used by the reliability layer. */
  repair(
    req: TranslationRequest,
    previous: TranslationResult,
    issues: string[],
    signal?: AbortSignal,
  ): Promise<TranslationResult>;
}

export class TranslationError extends Error {
  constructor(
    public readonly kind: "auth" | "quota" | "rate" | "network" | "provider" | "input",
    message: string,
  ) {
    super(message);
  }
}

export type StyleOverride = "natural" | "formal" | "casual";

export type Dialect = "auto" | "msa" | "levant" | "egypt" | "gulf" | "iraq" | "maghreb";
export type ModelId = "gpt-5.6-luna" | "gpt-6-luna" | "glm-5.3-flash";
export const MODELS: readonly ModelId[] = ["gpt-5.6-luna", "gpt-6-luna", "glm-5.3-flash"];
export const MODEL_LABEL: Record<ModelId, string> = {
  "gpt-5.6-luna": "Luna 5.6",
  "gpt-6-luna": "Luna 6",
  "glm-5.3-flash": "GLM Flash · beta",
};
export type Situation = "chat" | "work" | "official" | "general";

export interface TranslationRequest {
  text: string;
  /** BCP-ish short code, or "auto" for detection */
  source: string;
  target: string;
  style: StyleOverride;
  /** Arabic variety for Arabic output; "auto" follows the source. */
  dialect?: Dialect;
  /** Which model translates; defaults to gpt-5.6-luna. */
  model?: ModelId;
  /** Text still being typed: translate provisionally, skip the repair pass. */
  partial?: boolean;
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

export type StyleOverride = "natural" | "formal" | "casual";

export interface TranslationRequest {
  text: string;
  /** BCP-ish short code, or "auto" for detection */
  source: string;
  target: string;
  style: StyleOverride;
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
    public readonly kind: "auth" | "rate" | "network" | "provider" | "input",
    message: string,
  ) {
    super(message);
  }
}

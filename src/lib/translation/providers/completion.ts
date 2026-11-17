import { TranslationError } from "../types";

/**
 * The provider completion contract, shared by streaming and non-streaming calls.
 *
 * The documented `finish_reason` enum is `stop | length | content_filter | tool_calls |
 * insufficient_system_resource | aborted`
 * (https://api-docs.deepseek.com/api/create-chat-completion.md, accessed 2026-11-17).
 * Only `stop` means the answer finished naturally. A non-streaming call used to read
 * `choices[0].message.content` without looking at this field, so a reply cut at the output
 * ceiling surfaced later as "Malformed model output" — a parser accident instead of the
 * provider fact it is (TD35). The SSE reader already classified the same values (TD46).
 *
 * Never treat a cut reply as a success: a truncated structured answer is invalid JSON, and
 * a truncated plain answer silently loses its ending.
 */
export function completionError(reason: unknown): TranslationError | null {
  if (reason === "stop") return null;
  if (reason === "length")
    return new TranslationError("provider", "The provider reply was truncated.");
  if (reason === "content_filter")
    return new TranslationError("provider", "The provider filtered the reply.");
  if (reason === "tool_calls")
    return new TranslationError("provider", "The provider ended the reply with a tool call.");
  // Missing or undocumented reason: the completion is not proven, so it is not a success.
  return new TranslationError("provider", "The provider ended the reply unexpectedly.");
}

/** Throws unless the provider reported the documented normal stop. */
export function requireCompletion(reason: unknown): void {
  const error = completionError(reason);
  if (error) throw error;
}

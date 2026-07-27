import type { ThinkingLevel } from "@/lib/constants";
import type { Provider } from "@/lib/providers/config";

/** Raised when a provider's API key is absent — surfaced as a 503 to the client
 *  so the UI can tell the user to add the key (keys are server-side only). */
export class ProviderNotConfiguredError extends Error {
  constructor(public provider: Provider) {
    super(`The ${provider} provider is not configured on the server.`);
    this.name = "ProviderNotConfiguredError";
  }
}

/** Raised when a provider call fails (network, auth, model error). */
export class ProviderError extends Error {
  constructor(
    public provider: Provider,
    message: string,
    /** Upstream HTTP status, when the provider returned one (401, 404, …). */
    public status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** One raw chunk from a provider's token stream: undecoded response text
 *  and/or a cumulative usage snapshot. The adapter's envelope scanner turns
 *  the raw text into output-field deltas in one shared place. */
export interface ProviderStreamChunk {
  text?: string;
  usage?: { tokenIn: number; tokenOut: number };
  /** Provider-reported stop/finish reason, raw wire value ("max_tokens",
   *  "length", "MAX_TOKENS", …). Lets the adapter tell "hit the output
   *  ceiling" apart from "returned a malformed envelope". */
  stopReason?: string;
}

/** Per-request tuning an adapter may honor. `thinkingLevel` is the user's
 *  selection from the composer's thinking selector — already validated by the
 *  route against TARGET_THINKING_LEVELS, so an adapter can translate it onto
 *  its provider's parameter without re-checking. Absent = provider default. */
export interface ProviderRequestOptions {
  thinkingLevel?: ThinkingLevel;
}

/** Narrow the app-wide level onto the values the OpenAI SDK types accept —
 *  TARGET_THINKING_LEVELS only offers this trio for the GPT and Grok targets,
 *  and the guard keeps the wire value inside the typed set if that drifts. */
export function toReasoningEffort(
  level: string | undefined,
): "low" | "medium" | "high" | undefined {
  return level === "low" || level === "medium" || level === "high"
    ? level
    : undefined;
}

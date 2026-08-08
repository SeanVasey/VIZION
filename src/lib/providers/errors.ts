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
    /** Usage the provider REPORTED before failing (rare — some error bodies
     *  carry it). Lets /api/media settle real consumption instead of
     *  releasing the hold as if the call were free (MED-004). Never
     *  invented: absent unless the wire actually said so. */
    public usage?: { tokenIn: number; tokenOut: number },
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
  /** This `usage` is a HEADER SNAPSHOT, not a cumulative measurement — its
   *  `tokenOut` is a placeholder the provider sends before generating (
   *  Anthropic's `message_start` reports 1-4). Only the emitting adapter can
   *  know this, so it says so rather than leaving downstream code to guess
   *  from the value. Consumers may floor a snapshot with their own estimate;
   *  they must NOT do that to a real cumulative count, which would replace a
   *  measurement with a heuristic. */
  usageSnapshot?: boolean;
  /** Provider-reported stop/finish reason, raw wire value ("max_tokens",
   *  "length", "MAX_TOKENS", …). Lets the adapter tell "hit the output
   *  ceiling" apart from "returned a malformed envelope". */
  stopReason?: string;
  /** Reasoning tokens the provider BILLS as output but that never appear in
   *  `text` (stripped <think> spans, `reasoning_content` deltas). A floor
   *  contribution for the adapter's no-usage fallback estimate only —
   *  ignored whenever the provider reports real usage (PRV-003). */
  estReasoningTokens?: number;
}

/** Per-request tuning an adapter may honor. `thinkingLevel` is the user's
 *  selection from the composer's thinking selector — already validated by the
 *  route against TARGET_THINKING_LEVELS, so an adapter can translate it onto
 *  its provider's parameter without re-checking. Absent = provider default. */
export interface ProviderRequestOptions {
  thinkingLevel?: ThinkingLevel;
  /** Absolute epoch-ms wall for the whole call, taken by the ROUTE at entry.
   *  The budget has to start there, not in the adapter: auth, settings, JSON
   *  parsing and reserveSpend all run first, and time spent in them is time
   *  the platform's maxDuration is already counting. An adapter-local
   *  deadline silently excludes it, which is how a slow preflight plus a
   *  full-length stream can still outrun the window and skip the route's
   *  spend-settling finally. Absent (tests, direct adapter use) = take a
   *  fresh one. */
  deadline?: number;
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

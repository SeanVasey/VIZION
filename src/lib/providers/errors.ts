import { normalizeThinkingLevel, type ThinkingLevel } from "@/lib/constants";
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

/**
 * The sentence a provider's HTTP failure becomes, and the log line beside it.
 *
 * The 2026-09 screenshot read "Mistral request failed: 401 status code (no
 * body)" — a bare upstream status relayed to the one person who cannot act
 * on it. A 401/403 from ANY provider is the SERVER'S key being refused (a
 * revoked, expired, wrong-region or wrong-namespace key), never something the
 * prompt did; a 404 is the pinned model id no longer served on that key.
 * Both were already named for Gemini alone (the 2026-08 project-denied
 * incident); this generalizes that message to every adapter, in one place,
 * so the next refusal reads the same on every target and names the env var
 * an operator has to replace. `console.warn` survives the production strip,
 * so the deployment logs carry the status too.
 */
export function describeProviderFailure(
  provider: Provider,
  label: string,
  keyEnv: string,
  status: number | undefined,
  upstream: string,
): string {
  const base = `${label} request failed: ${upstream}`;
  // warn, not error: an operator-actionable refusal, not an app bug.
  console.warn(`[${provider}] upstream error`, status ?? "?", upstream);
  if (status === 401 || status === 403) {
    return `${base} — ${label} refused the server's API key (${keyEnv}), not this request. Replace the key in the deployment env with one that can call ${label}'s inference endpoint.`;
  }
  if (status === 404) {
    return `${base} — the pinned model id isn't served on this key. Point the MODEL_* override for ${label} at a model id the account serves.`;
  }
  return base;
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
 *  selection from the composer's thinking dial — already validated by the
 *  route against THINKING_LEVELS, so an adapter only has to translate it onto
 *  its provider's vocabulary (`providerEffort`). Absent = provider default. */
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

/**
 * The ONE translation table from the app's ladder onto each provider's
 * reasoning vocabulary (ADR-0018). The dial shows four stops for every
 * model; this is where "High" becomes whatever this provider calls high.
 *
 * Read down a column and the mapping is monotone — a higher stop never sends
 * a lower provider value — and where a provider has fewer than four values
 * the collapse is chosen so the ENDS stay honest: Low is the provider's
 * cheapest, Max is its most expensive (the peak caption promises "highest
 * cost", so Max may never quietly send a middle value).
 *
 *   ladder →   low      medium   high     max
 *   anthropic  low      medium   high     max      output_config.effort
 *   openai     low      medium   high     max      reasoning_effort (5.6 and 6)
 *   xai        low      medium   high     xhigh    reasoning_effort (4.6: xhigh is its top)
 *   google     low      medium   high     high     thinkingConfig.thinkingLevel (3.8: no minimal, no xhigh)
 *   deepseek   low      high     high     max      reasoning_effort (three values: low · high · max)
 *   moonshot   low      high     high     max      reasoning_effort (three values, default max)
 *   zai        low      high     high     max      reasoning_effort (three values, default max)
 *   qwen       (token budgets — openai-compat's QWEN_THINKING_BUDGET)
 *
 * Three-valued providers collapse Medium onto High rather than Low because
 * their "high" IS their middle value (low < high < max) and their default.
 * Sources: platform.claude.com/docs/en/build-with-claude/effort ·
 * developers.openai.com/api/docs/guides/reasoning · docs.x.ai/docs/guides/
 * reasoning · ai.google.dev/gemini-api/docs/latest-model ·
 * api-docs.deepseek.com/guides/thinking_mode · platform.kimi.ai ·
 * docs.z.ai/guides/llm/glm-5.3 — all read 2026-09-11.
 */
export type EffortVocabulary = "five" | "openai" | "xai" | "google" | "three";

const EFFORT_TABLE: Record<EffortVocabulary, Record<ThinkingLevel, string>> = {
  five: {
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  openai: {
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  xai: {
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "xhigh",
  },
  google: {
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "high",
    max: "high",
  },
  three: {
    minimal: "low",
    low: "low",
    medium: "high",
    high: "high",
    xhigh: "high",
    max: "max",
  },
};

/** Translate an app-ladder level onto a provider's own effort word. Undefined
 *  in = undefined out (Auto: the route already resolved a level, or the
 *  provider default applies). The wire-vocabulary legacy stops (`minimal`,
 *  `xhigh`) fold onto the ladder first, except where a provider genuinely
 *  serves `xhigh` (Anthropic, OpenAI, xAI) — there it rides through as its
 *  own value, since it is a real, distinct tier on that API. */
export function providerEffort(
  vocabulary: EffortVocabulary,
  level: ThinkingLevel | undefined,
): string | undefined {
  if (!level) return undefined;
  const table = EFFORT_TABLE[vocabulary];
  const keepsXhigh =
    vocabulary === "five" || vocabulary === "openai" || vocabulary === "xai";
  return table[keepsXhigh ? level : normalizeThinkingLevel(level)];
}

/** Whether a level is in the provider's DEEP tier — the two top ladder stops,
 *  where reasoning bills against the output ceiling hard enough that the
 *  adapters raise `max_tokens`. One rule for every adapter, so the headroom
 *  ladder cannot drift per provider again (audit 04 uncertain-01). */
export function isDeepEffort(level: ThinkingLevel | undefined): boolean {
  return level === "high" || level === "xhigh" || level === "max";
}

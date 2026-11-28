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
 * Raised when the model itself DECLINED the request — a completed, HTTP-200
 * response whose stop reason is a refusal, with no usable output.
 *
 * Not a ProviderError: nothing failed. The key is fine, the model id is
 * served, the request was well-formed; a safety classifier ended the turn.
 * The Claude 5.5 generation made this an ordinary outcome rather than a
 * rarity — `stop_reason: "refusal"` with a category (cyber, bio,
 * frontier_llm, reasoning_extraction, general_harms; platform.claude.com
 * refusals docs, 2026-11) — and a prompt-engineering tool is exactly where
 * a security or biology prompt arrives as legitimate input. Unhandled, the
 * empty stream fell through to "The model returned a non-JSON response.",
 * which names the wrong party and offers no next step.
 */
export class ProviderRefusalError extends Error {
  constructor(
    public provider: Provider,
    /** The provider's own category word, when it gave one. Relayed, never
     *  interpreted: the set is open and vendor-defined. */
    public category?: string,
  ) {
    super(
      `The model declined this request${category ? ` (${category})` : ""}. Nothing was produced — try a different target model, or rephrase the prompt.`,
    );
    this.name = "ProviderRefusalError";
  }
}

/** Stop/finish wire values that mean "the model declined" (Anthropic:
 *  refusal · OpenAI-compat: content_filter · Gemini: SAFETY, PROHIBITED_CONTENT,
 *  BLOCKLIST, SPII, RECITATION). */
export const REFUSAL_STOPS: ReadonlySet<string> = new Set([
  "refusal",
  "content_filter",
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
]);

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
  /** The provider's refusal category, when a refusal stop carried one
   *  (Anthropic `stop_details.category`). Display-only. */
  refusalCategory?: string;
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
  /** The TARGET's effort vocabulary (`TARGETS[id].effort`), supplied by the
   *  adapter layer, which is the only caller that knows the target. Models
   *  from one provider no longer share a vocabulary, so the provider adapter
   *  cannot assume one. Absent (tests, direct adapter use) = the adapter's
   *  own documented fallback. */
  effortVocabulary?: EffortVocabulary;
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
 * The ONE translation table from the app's ladder onto each API's reasoning
 * vocabulary (ADR-0018). The dial shows four stops for every model; this is
 * where "High" becomes whatever this model's API calls high.
 *
 * A vocabulary is named for its SHAPE, not for a vendor, and it is chosen
 * PER TARGET (`TARGETS[id].effort` in config.ts), not per provider. Until
 * 2026-11 it was per provider, which held only while every model a vendor
 * served took the same words. Gemini 4 ended that: Carbon tops out at `high`
 * while Neon and Hydrogen add `xhigh`, so "the Google vocabulary" would have
 * either 400'd Carbon or quietly capped the other two a stop short of what
 * the peak caption promises.
 *
 * Read down a column and the mapping is monotone — a higher stop never sends
 * a lower word — and where an API has fewer than four words the collapse is
 * chosen so the ENDS stay honest: Low is its cheapest, Max is its most
 * expensive (the peak caption promises "highest cost", so Max may never
 * quietly send a middle value).
 *
 *   ladder →  low      medium   high     max      who (2026-11-28)
 *   five      low      medium   high     max      Anthropic (output_config.effort) · Muse · MiniMax M3.1
 *   openai    low      medium   high     max      GPT-6.2 / 6.1 / 6 — reasoning_effort
 *   toXhigh   low      medium   high     xhigh    Grok 4.7 · Gemini 4 Neon, Hydrogen
 *   toHigh    low      medium   high     high     Gemini 4 Carbon · Mistral Large 4
 *   three     low      high     high     max      DeepSeek V4 · Kimi · GLM (low · high · max)
 *   threeX    low      high     high     xhigh    Qwen4 Max (low · high · xhigh)
 *
 * Three-valued APIs collapse Medium onto High rather than Low because their
 * "high" IS their middle word (low < high < max). That collapse is also why
 * Auto does not send Medium to them — see `hasDistinctMedium` below.
 *
 * Sources, all read 2026-11-28: platform.claude.com effort docs ·
 * developers.openai.com/api/docs/guides/reasoning (+ per-model pages; `none`
 * is rejected on 6.2 and never sent) · docs.x.ai model-capabilities/text/
 * reasoning · aistudio.google.com/docs/thinking · docs.mistral.ai/inference/
 * conversations/reasoning · api-docs.deepseek.com/guides/thinking_mode ·
 * platform.kimi.ai · docs.z.ai/guides/llm/glm-5.3 · alibabacloud.com/help/en/
 * model-studio/qwen4-max · dev.meta.ai/docs/reasoning · platform.minimax.io
 * text-openai-api.
 */
export type EffortVocabulary =
  | "five"
  | "openai"
  | "toXhigh"
  | "toHigh"
  | "three"
  | "threeX";

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
  toXhigh: {
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "xhigh",
  },
  toHigh: {
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
  threeX: {
    minimal: "low",
    low: "low",
    medium: "high",
    high: "high",
    xhigh: "xhigh",
    max: "xhigh",
  },
};

/** Translate an app-ladder level onto an API's own effort word. Undefined
 *  in = undefined out (the target has no knob, or a direct adapter call left
 *  it unset). The wire-vocabulary legacy stops (`minimal`, `xhigh`) fold onto
 *  the ladder first, except where the API genuinely serves `xhigh` — there it
 *  rides through as its own value, since it is a real, distinct tier. */
export function providerEffort(
  vocabulary: EffortVocabulary,
  level: ThinkingLevel | undefined,
): string | undefined {
  if (!level) return undefined;
  const table = EFFORT_TABLE[vocabulary];
  const keepsXhigh =
    vocabulary === "five" ||
    vocabulary === "openai" ||
    vocabulary === "toXhigh" ||
    vocabulary === "threeX";
  return table[keepsXhigh ? level : normalizeThinkingLevel(level)];
}

/**
 * Whether Medium is a word of its own on this API, or only a second name for
 * High. Auto's "moderate" default reads this: sending Medium to a
 * three-valued API lands on `high`, so the light tier would cost exactly what
 * the heavy tier does and Auto would be choosing nothing. Derived from the
 * table rather than listed, so a new vocabulary cannot be forgotten here.
 */
export function hasDistinctMedium(vocabulary: EffortVocabulary): boolean {
  return providerEffort(vocabulary, "medium") !== providerEffort(vocabulary, "high");
}

/** Whether a level is in the provider's DEEP tier — the two top ladder stops,
 *  where reasoning bills against the output ceiling hard enough that the
 *  adapters raise `max_tokens`. One rule for every adapter, so the headroom
 *  ladder cannot drift per provider again (audit 04 uncertain-01). */
export function isDeepEffort(level: ThinkingLevel | undefined): boolean {
  return level === "high" || level === "xhigh" || level === "max";
}

import "server-only";
import OpenAI from "openai";
import type { ThinkingLevel } from "@/lib/constants";
import {
  PROVIDER_MAX_RETRIES,
  PROVIDER_TOTAL_MS,
  numEnv,
  type Provider,
} from "@/lib/providers/config";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderRequestOptions,
  type ProviderStreamChunk,
} from "@/lib/providers/errors";
import { withIdleTimeout } from "@/lib/providers/idle-timeout";

/**
 * Shared streaming adapter for OpenAI-compatible chat APIs. The 2026-07 roster
 * expansion added six providers that all speak the OpenAI wire shape, so the
 * per-provider file pattern (mistral.ts, xai.ts) would have been six copies of
 * the same 60 lines — this factory holds the one implementation and the
 * providers below configure it. Server-side only; keys never reach the client.
 *
 * Two lessons from the earlier providers are baked in:
 * - No `stream_options`: some compat APIs reject unknown request fields with a
 *   422 (the Mistral lesson). Providers that report usage do so unprompted in
 *   the final chunk; when none arrives the adapter falls back to its ~4
 *   chars/token estimate.
 * - Classic `max_tokens` (not `max_completion_tokens`) — the widest-supported
 *   output-ceiling field across compat APIs. 16k keeps runaways bounded, and a
 *   provider whose API caps it lower declares its own (`maxTokens`).
 */
interface CompatOptions {
  provider: Provider;
  /** Human name for error messages ("Kimi request failed: …"). */
  label: string;
  keyEnv: string;
  baseURL: string;
  /** Set false for APIs that reject `response_format: json_object` (Perplexity
   *  only takes json_schema). The system prompt still demands the JSON
   *  envelope and parseEnhancePayload validates it. */
  jsonMode?: boolean;
  /** Strip `<think>…</think>` spans that interleaved-reasoning models
   *  (MiniMax M-series) emit inside `content` — left in, they'd corrupt the
   *  JSON envelope the adapter decodes. */
  stripThink?: boolean;
  /** Output ceiling for this API. Defaults to 16k; declare it when the API
   *  rejects that (DashScope caps `qwen-max` at 8192 and 400s above it, which
   *  failed EVERY Qwen run — the ceiling is a per-API fact, not a preference). */
  maxTokens?: number;
  /** Thinking-token budget per app-wide level, for compat APIs whose reasoning
   *  knob is a BUDGET rather than an effort word (DashScope: `enable_thinking`
   *  + `thinking_budget`). Absent = this provider exposes no per-request knob,
   *  so `TARGET_THINKING_LEVELS` must not list its targets either. */
  thinkingBudget?: Partial<Record<ThinkingLevel, number>>;
}

/** The streaming request body, widened for the non-standard keys a compat API
 *  may accept (DashScope's thinking pair). Unknown keys pass through the SDK
 *  to the wire as-is. */
export type CompatBody = OpenAI.ChatCompletionCreateParamsStreaming &
  Record<string, unknown>;

/**
 * Pure request-body builder (exported for tests — no SDK mocking needed).
 *
 * `req.thinkingLevel` is already validated by the route against
 * TARGET_THINKING_LEVELS, so a level with no budget entry simply sends nothing
 * and the provider's own default applies — the same "Auto" semantics as every
 * other adapter.
 */
export function buildCompatBody(
  opts: CompatOptions,
  system: string,
  input: string,
  model: string,
  req: ProviderRequestOptions = {},
): CompatBody {
  const body: CompatBody = {
    model,
    max_tokens: opts.maxTokens ?? 16_000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: input },
    ],
    ...(opts.jsonMode === false
      ? {}
      : { response_format: { type: "json_object" as const } }),
    stream: true,
  };
  const budget = req.thinkingLevel
    ? opts.thinkingBudget?.[req.thinkingLevel]
    : undefined;
  if (budget !== undefined) {
    // DashScope only honours thinking on a streamed request, which this always
    // is. Reasoning arrives in `delta.reasoning_content` — a field we never
    // read — so the `content` stream stays clean JSON and needs no filter.
    body.enable_thinking = true;
    body.thinking_budget = budget;
  }
  return body;
}

export function makeOpenAICompatStream(opts: CompatOptions) {
  return async function* stream(
    system: string,
    input: string,
    model: string,
    req: ProviderRequestOptions = {},
  ): AsyncGenerator<ProviderStreamChunk> {
    const apiKey = process.env[opts.keyEnv];
    if (!apiKey) throw new ProviderNotConfiguredError(opts.provider);

    const client = new OpenAI({
      apiKey,
      baseURL: opts.baseURL,
      timeout: PROVIDER_TOTAL_MS,
      maxRetries: PROVIDER_MAX_RETRIES,
    });
    const filter = opts.stripThink ? createThinkFilter() : null;
    // Reasoning the provider bills but never surfaces in `content`: stripped
    // <think> spans and `reasoning_content` deltas. Counted so the adapter's
    // no-usage fallback estimate doesn't systematically exclude exactly the
    // runs that think hardest (PRV-003). Real usage always wins.
    let reasoningChars = 0;
    // Filter accounting is cumulative (a tag can span chunks): stripped
    // chars = everything pushed in minus everything emitted, settled after
    // the final flush.
    let filterIn = 0;
    let filterOut = 0;

    try {
      const completion = await client.chat.completions.create(
        buildCompatBody(opts, system, input, model, req),
      );
      // Idle-bounded, not wall-clock bounded — the SDK `timeout` above covers
      // the streamed body read, so alone it would kill healthy long runs.
      for await (const chunk of withIdleTimeout(completion, opts.provider)) {
        const delta = chunk.choices[0]?.delta as
          | { content?: string | null; reasoning_content?: string }
          | undefined;
        reasoningChars += delta?.reasoning_content?.length ?? 0;
        let text = delta?.content ?? "";
        if (text && filter) {
          filterIn += text.length;
          text = filter.push(text);
          filterOut += text.length;
        }
        if (text) yield { text };
        const finish = chunk.choices[0]?.finish_reason;
        if (finish) yield { stopReason: finish };
        if (chunk.usage) {
          yield {
            usage: {
              tokenIn: chunk.usage.prompt_tokens,
              tokenOut: chunk.usage.completion_tokens,
            },
          };
        }
      }
      // The filter may be holding back a tail that looked like a partial tag
      // but never completed into one — flush it so the envelope stays whole.
      if (filter) {
        const tail = filter.flush();
        if (tail) {
          yield { text: tail };
          filterOut += tail.length;
        }
        reasoningChars += Math.max(0, filterIn - filterOut);
      }
      if (reasoningChars > 0) {
        yield { estReasoningTokens: Math.ceil(reasoningChars / 4) };
      }
    } catch (error) {
      if (error instanceof ProviderNotConfiguredError) throw error;
      // Already shaped (e.g. the idle-timeout 504) — re-wrapping drops status.
      if (error instanceof ProviderError) throw error;
      if (error instanceof OpenAI.APIError) {
        throw new ProviderError(
          opts.provider,
          `${opts.label} request failed: ${error.message}`,
          error.status,
        );
      }
      throw new ProviderError(
        opts.provider,
        error instanceof Error ? error.message : `Unknown ${opts.label} error.`,
      );
    }
  };
}

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

/** Stateful cross-chunk filter that removes `<think>…</think>` spans from a
 *  token stream. A tag can be split across chunks, so a suffix that could
 *  still complete into a tag is held back until the next push resolves it. */
function createThinkFilter(): { push: (text: string) => string; flush: () => string } {
  let pending = "";
  let inThink = false;
  return {
    push(text) {
      pending += text;
      let out = "";
      for (;;) {
        if (inThink) {
          const close = pending.indexOf(CLOSE_TAG);
          if (close === -1) {
            pending = partialTagSuffix(pending, CLOSE_TAG);
            return out;
          }
          pending = pending.slice(close + CLOSE_TAG.length);
          inThink = false;
        } else {
          const open = pending.indexOf(OPEN_TAG);
          if (open === -1) {
            const hold = partialTagSuffix(pending, OPEN_TAG);
            out += pending.slice(0, pending.length - hold.length);
            pending = hold;
            return out;
          }
          out += pending.slice(0, open);
          pending = pending.slice(open + OPEN_TAG.length);
          inThink = true;
        }
      }
    },
    flush() {
      const tail = inThink ? "" : pending;
      pending = "";
      return tail;
    },
  };
}

/** Longest suffix of `s` that is a proper prefix of `tag` (i.e. could still
 *  grow into the tag on a later chunk); empty when no such suffix exists. */
function partialTagSuffix(s: string, tag: string): string {
  const max = Math.min(s.length, tag.length - 1);
  for (let len = max; len > 0; len--) {
    if (s.endsWith(tag.slice(0, len))) return s.slice(s.length - len);
  }
  return "";
}

/** DeepSeek reports reasoning in a separate `reasoning_content` field (which
 *  we never read), so `content` is clean JSON — no think filter needed. */
export const streamDeepSeek = makeOpenAICompatStream({
  provider: "deepseek",
  label: "DeepSeek",
  keyEnv: "DEEPSEEK_API_KEY",
  baseURL: "https://api.deepseek.com/v1",
});

/** Meta Model API — Muse Spark (Meta Superintelligence Labs), the successor
 *  to the retired Llama API endpoint. */
export const streamMeta = makeOpenAICompatStream({
  provider: "meta",
  label: "Muse Spark",
  keyEnv: "META_API_KEY",
  baseURL: "https://api.meta.ai/v1",
});

export const streamMiniMax = makeOpenAICompatStream({
  provider: "minimax",
  label: "MiniMax",
  keyEnv: "MINIMAX_API_KEY",
  baseURL: "https://api.minimax.io/v1",
  stripThink: true,
});

export const streamMoonshot = makeOpenAICompatStream({
  provider: "moonshot",
  label: "Kimi",
  keyEnv: "MOONSHOT_API_KEY",
  baseURL: "https://api.moonshot.ai/v1",
});

export const streamPerplexity = makeOpenAICompatStream({
  provider: "perplexity",
  label: "Sonar",
  keyEnv: "PERPLEXITY_API_KEY",
  baseURL: "https://api.perplexity.ai",
  jsonMode: false,
});

/**
 * DashScope thinking budgets, in reasoning tokens, per app-wide level.
 *
 * Qwen's reasoning knob is a BUDGET, not an effort word, so the whole
 * five-step ladder maps cleanly onto it. Every step stays well under the 8192
 * output ceiling: reasoning that eats the ceiling leaves nothing for the JSON
 * envelope, which surfaces as the adapter's "hit its length limit" error
 * rather than as a result. `max` is half the ceiling for exactly that reason.
 */
const QWEN_THINKING_BUDGET: Partial<Record<ThinkingLevel, number>> = {
  low: 512,
  medium: 1024,
  high: 2048,
  xhigh: 3072,
  max: 4096,
};

/** Alibaba Model Studio's OpenAI-compatible endpoint (international region).
 *  "Max" in `Qwen3.8 Max` is the MODEL TIER — Alibaba's flagship, next to Plus
 *  and Turbo — and says nothing about reasoning depth, which is the separate
 *  per-request `enable_thinking`/`thinking_budget` pair below. */
export const streamQwen = makeOpenAICompatStream({
  provider: "qwen",
  label: "Qwen",
  keyEnv: "DASHSCOPE_API_KEY",
  baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  // DashScope rejected anything above 8192 for qwen3.7-max with a 400
  // InvalidParameter, and this is the tightest ceiling in the fleet — the max
  // thinking budget (4096) alone eats half of it, which is why Qwen truncates
  // sooner than any other target. Kept at 8192 because raising it on a guess
  // trades a truncation for a hard 400 on every call; env-overridable so the
  // real 3.8 Max ceiling can be dialled in from the vendor's model page
  // without a deploy. See docs/runbooks/providers.md.
  maxTokens: numEnv("MAX_TOKENS_QWEN", 8_192),
  thinkingBudget: QWEN_THINKING_BUDGET,
});

/** Z.ai open platform (GLM). Reasoning arrives in a separate
 *  `reasoning_content`-style field on the official endpoint (which we never
 *  read), so `content` is clean — no think filter needed. */
export const streamZai = makeOpenAICompatStream({
  provider: "zai",
  label: "GLM",
  keyEnv: "ZAI_API_KEY",
  baseURL: "https://api.z.ai/api/paas/v4",
});

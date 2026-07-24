import "server-only";
import OpenAI from "openai";
import type { Provider } from "@/lib/providers/config";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderStreamChunk,
} from "@/lib/providers/errors";

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
 *   output-ceiling field across compat APIs. 16k for adapter parity.
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
}

export function makeOpenAICompatStream(opts: CompatOptions) {
  return async function* stream(
    system: string,
    input: string,
    model: string,
  ): AsyncGenerator<ProviderStreamChunk> {
    const apiKey = process.env[opts.keyEnv];
    if (!apiKey) throw new ProviderNotConfiguredError(opts.provider);

    const client = new OpenAI({ apiKey, baseURL: opts.baseURL });
    const filter = opts.stripThink ? createThinkFilter() : null;

    try {
      const completion = await client.chat.completions.create({
        model,
        max_tokens: 16_000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: input },
        ],
        ...(opts.jsonMode === false
          ? {}
          : { response_format: { type: "json_object" as const } }),
        stream: true,
      });
      for await (const chunk of completion) {
        let text = chunk.choices[0]?.delta?.content ?? "";
        if (text && filter) text = filter.push(text);
        if (text) yield { text };
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
        if (tail) yield { text: tail };
      }
    } catch (error) {
      if (error instanceof ProviderNotConfiguredError) throw error;
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

export const streamMeta = makeOpenAICompatStream({
  provider: "meta",
  label: "Llama",
  keyEnv: "LLAMA_API_KEY",
  baseURL: "https://api.llama.com/compat/v1",
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

/** Alibaba Model Studio's OpenAI-compatible endpoint (international region). */
export const streamQwen = makeOpenAICompatStream({
  provider: "qwen",
  label: "Qwen",
  keyEnv: "DASHSCOPE_API_KEY",
  baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
});

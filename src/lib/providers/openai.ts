import "server-only";
import OpenAI from "openai";
import { PROVIDER_MAX_RETRIES, PROVIDER_TOTAL_MS } from "@/lib/providers/config";
import {
  ProviderError,
  ProviderNotConfiguredError,
  toReasoningEffort,
  type ProviderRequestOptions,
  type ProviderStreamChunk,
} from "@/lib/providers/errors";
import { withIdleTimeout } from "@/lib/providers/idle-timeout";

/**
 * Streaming OpenAI (GPT) call: yields raw response-text deltas, then one
 * cumulative usage snapshot from the final chunk (stream_options.include_usage).
 * Server-side only; key never reaches the client. The JSON envelope is decoded
 * centrally in the adapter.
 *
 * `opts.thinkingLevel` maps onto `reasoning_effort`; omitted leaves the
 * model's own default in place.
 */
export async function* streamOpenAI(
  system: string,
  input: string,
  model: string,
  opts: ProviderRequestOptions = {},
): AsyncGenerator<ProviderStreamChunk> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("openai");

  const client = new OpenAI({
    apiKey,
    timeout: PROVIDER_TOTAL_MS,
    maxRetries: PROVIDER_MAX_RETRIES,
  });
  const reasoningEffort = toReasoningEffort(opts.thinkingLevel);

  try {
    const stream = await client.chat.completions.create({
      model,
      // Output ceiling: a runaway generation must stay bounded — the cost
      // cap is only checked pre-call. Reasoning bills against this ceiling
      // (the Anthropic path learned this first), so high effort gets the
      // headroom that keeps a heavy pass from truncating the envelope.
      max_completion_tokens: reasoningEffort === "high" ? 32_000 : 16_000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
      response_format: { type: "json_object" },
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      stream: true,
      stream_options: { include_usage: true },
    });
    // Idle-bounded, not wall-clock bounded — the SDK `timeout` above covers
    // the streamed body read, so alone it would kill healthy long runs.
    for await (const chunk of withIdleTimeout(stream, "openai")) {
      const text = chunk.choices[0]?.delta?.content;
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
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) throw error;
    // Already shaped (e.g. the idle-timeout 504) — re-wrapping drops status.
    if (error instanceof ProviderError) throw error;
    if (error instanceof OpenAI.APIError) {
      // Keep the upstream status so callers can classify (401/403/404 are
      // deployment-shaped, not input-shaped) — same contract as vision.
      throw new ProviderError("openai", `GPT request failed: ${error.message}`, error.status);
    }
    throw new ProviderError(
      "openai",
      error instanceof Error ? error.message : "Unknown GPT error.",
    );
  }
}

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

/** xAI's API is OpenAI-compatible, so the adapter is the OpenAI SDK pointed
 *  at api.x.ai — no extra dependency. */
const XAI_BASE_URL = "https://api.x.ai/v1";

/**
 * Streaming xAI (Grok) call: raw response-text deltas plus a final cumulative
 * usage snapshot. Server-side only; key never reaches the client.
 *
 * `opts.thinkingLevel` maps onto Grok's `reasoning_effort` (low/medium/high;
 * xAI defaults to high and reasoning can't be disabled).
 */
export async function* streamXAI(
  system: string,
  input: string,
  model: string,
  opts: ProviderRequestOptions = {},
): AsyncGenerator<ProviderStreamChunk> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("xai");

  const client = new OpenAI({
    apiKey,
    baseURL: XAI_BASE_URL,
    timeout: PROVIDER_TOTAL_MS,
    maxRetries: PROVIDER_MAX_RETRIES,
  });
  const reasoningEffort = toReasoningEffort(opts.thinkingLevel);

  try {
    const stream = await client.chat.completions.create({
      model,
      // Output ceiling: a runaway generation must stay bounded.
      max_tokens: 16_000,
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
    for await (const chunk of withIdleTimeout(stream, "xai")) {
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
      throw new ProviderError("xai", `Grok request failed: ${error.message}`, error.status);
    }
    throw new ProviderError(
      "xai",
      error instanceof Error ? error.message : "Unknown Grok error.",
    );
  }
}

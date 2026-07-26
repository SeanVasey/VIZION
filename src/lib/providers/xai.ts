import "server-only";
import OpenAI from "openai";
import {
  ProviderError,
  ProviderNotConfiguredError,
  toReasoningEffort,
  type ProviderRequestOptions,
  type ProviderStreamChunk,
} from "@/lib/providers/errors";

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

  const client = new OpenAI({ apiKey, baseURL: XAI_BASE_URL });
  const reasoningEffort = toReasoningEffort(opts.thinkingLevel);

  try {
    const stream = await client.chat.completions.create({
      model,
      // Output ceiling for adapter parity (Anthropic caps at 16k).
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
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
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
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) throw error;
    if (error instanceof OpenAI.APIError) {
      throw new ProviderError("xai", `Grok request failed: ${error.message}`, error.status);
    }
    throw new ProviderError(
      "xai",
      error instanceof Error ? error.message : "Unknown Grok error.",
    );
  }
}

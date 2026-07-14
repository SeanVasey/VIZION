import "server-only";
import OpenAI from "openai";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderStreamChunk,
} from "@/lib/providers/errors";

/**
 * Streaming OpenAI (GPT) call: yields raw response-text deltas, then one
 * cumulative usage snapshot from the final chunk (stream_options.include_usage).
 * Server-side only; key never reaches the client. The JSON envelope is decoded
 * centrally in the adapter.
 */
export async function* streamOpenAI(
  system: string,
  input: string,
  model: string,
): AsyncGenerator<ProviderStreamChunk> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("openai");

  const client = new OpenAI({ apiKey });

  try {
    const stream = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
      response_format: { type: "json_object" },
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
      throw new ProviderError("openai", `GPT request failed: ${error.message}`);
    }
    throw new ProviderError(
      "openai",
      error instanceof Error ? error.message : "Unknown GPT error.",
    );
  }
}

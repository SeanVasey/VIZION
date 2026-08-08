import "server-only";
import OpenAI from "openai";
import { PROVIDER_MAX_RETRIES, PROVIDER_TOTAL_MS } from "@/lib/providers/config";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderStreamChunk,
} from "@/lib/providers/errors";
import { withIdleTimeout } from "@/lib/providers/idle-timeout";

/** Mistral's chat API is OpenAI-compatible (incl. json_object + streaming),
 *  so the adapter is the OpenAI SDK pointed at api.mistral.ai — no extra
 *  dependency (same pattern as xai.ts). */
const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";

/**
 * Streaming Mistral call: raw response-text deltas plus a cumulative usage
 * snapshot from the final chunk. NOTE: Mistral rejects unknown request fields
 * (422), so no stream_options here — its final stream chunk carries usage by
 * default. Server-side only; key never reaches the client.
 */
export async function* streamMistral(
  system: string,
  input: string,
  model: string,
): AsyncGenerator<ProviderStreamChunk> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("mistral");

  const client = new OpenAI({
    apiKey,
    baseURL: MISTRAL_BASE_URL,
    timeout: PROVIDER_TOTAL_MS,
    maxRetries: PROVIDER_MAX_RETRIES,
  });

  try {
    const stream = await client.chat.completions.create({
      model,
      // Output ceiling: a runaway generation must stay bounded. Classic
      // max_tokens — Mistral 422s on unknown fields like max_completion_tokens.
      max_tokens: 16_000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
      response_format: { type: "json_object" },
      stream: true,
    });
    // Idle-bounded, not wall-clock bounded — the SDK `timeout` above covers
    // the streamed body read, so alone it would kill healthy long runs.
    for await (const chunk of withIdleTimeout(stream, "mistral")) {
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
      throw new ProviderError(
        "mistral",
        `Mistral request failed: ${error.message}`,
        error.status,
      );
    }
    throw new ProviderError(
      "mistral",
      error instanceof Error ? error.message : "Unknown Mistral error.",
    );
  }
}

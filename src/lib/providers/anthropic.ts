import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderStreamChunk,
} from "@/lib/providers/errors";
import { MEDIA_EXTRACT_SYSTEM, parseMediaAttributes } from "@/lib/media/extract";
import type { MediaAttributes } from "@/lib/media/types";

type AnthropicImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/**
 * Vision extraction (proxy path, default per the locked open question). Reads an
 * image and returns detected attributes + token usage for the cost cap. Server-
 * side only; the key never reaches the client.
 */
export async function extractImageAttributes(
  base64: string,
  mediaType: string,
  model: string,
): Promise<{ attrs: Partial<MediaAttributes>; tokenIn: number; tokenOut: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("anthropic");

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: MEDIA_EXTRACT_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as AnthropicImageMediaType,
                data: base64,
              },
            },
            { type: "text", text: "Extract the attributes as JSON." },
          ],
        },
      ],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      attrs: parseMediaAttributes(text),
      tokenIn: response.usage.input_tokens,
      tokenOut: response.usage.output_tokens,
    };
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) throw error;
    if (error instanceof Anthropic.APIError) {
      throw new ProviderError("anthropic", `Vision request failed: ${error.message}`);
    }
    throw new ProviderError(
      "anthropic",
      error instanceof Error ? error.message : "Unknown vision error.",
    );
  }
}

/**
 * Streaming Anthropic call: yields raw response-text deltas plus cumulative
 * usage snapshots (input tokens from message_start, output tokens updated by
 * each message_delta). The adapter decodes the JSON envelope centrally.
 */
export async function* streamAnthropic(
  system: string,
  input: string,
  model: string,
): AsyncGenerator<ProviderStreamChunk> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("anthropic");

  const client = new Anthropic({ apiKey });
  let tokenIn = 0;

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 16_000,
      system,
      messages: [{ role: "user", content: input }],
    });
    for await (const event of stream) {
      if (event.type === "message_start") {
        tokenIn = event.message.usage.input_tokens;
        yield { usage: { tokenIn, tokenOut: event.message.usage.output_tokens } };
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { text: event.delta.text };
      } else if (event.type === "message_delta") {
        yield { usage: { tokenIn, tokenOut: event.usage.output_tokens } };
      }
    }
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) throw error;
    if (error instanceof Anthropic.APIError) {
      throw new ProviderError("anthropic", `Opus request failed: ${error.message}`);
    }
    throw new ProviderError(
      "anthropic",
      error instanceof Error ? error.message : "Unknown Opus error.",
    );
  }
}

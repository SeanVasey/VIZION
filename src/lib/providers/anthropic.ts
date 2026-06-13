import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { parseEnhancePayload } from "@/lib/providers/formatters";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderResult,
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
 * Anthropic (Opus) adapter. Called server-side only; the key never reaches the
 * client. Uses the official SDK per the Claude API guidance, with the JSON-only
 * contract enforced in the system prompt and validated on parse.
 */
export async function callAnthropic(
  system: string,
  input: string,
  model: string,
): Promise<ProviderResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("anthropic");

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 16_000,
      system,
      messages: [{ role: "user", content: input }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      ...parseEnhancePayload(text),
      tokenIn: response.usage.input_tokens,
      tokenOut: response.usage.output_tokens,
    };
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

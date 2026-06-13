import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { parseEnhancePayload } from "@/lib/providers/formatters";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderResult,
} from "@/lib/providers/errors";

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

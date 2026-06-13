import "server-only";
import OpenAI from "openai";
import { parseEnhancePayload } from "@/lib/providers/formatters";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderResult,
} from "@/lib/providers/errors";

/** OpenAI (GPT) adapter. Server-side only; key never reaches the client. */
export async function callOpenAI(
  system: string,
  input: string,
  model: string,
): Promise<ProviderResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("openai");

  const client = new OpenAI({ apiKey });

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
      response_format: { type: "json_object" },
    });

    const text = response.choices[0]?.message?.content ?? "";
    return {
      ...parseEnhancePayload(text),
      tokenIn: response.usage?.prompt_tokens ?? 0,
      tokenOut: response.usage?.completion_tokens ?? 0,
    };
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

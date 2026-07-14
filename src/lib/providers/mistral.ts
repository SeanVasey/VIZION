import "server-only";
import OpenAI from "openai";
import { parseEnhancePayload } from "@/lib/providers/formatters";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderResult,
} from "@/lib/providers/errors";

/** Mistral's chat API is OpenAI-compatible (incl. json_object + streaming),
 *  so the adapter is the OpenAI SDK pointed at api.mistral.ai — no extra
 *  dependency (same pattern as xai.ts). */
const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";

/** Mistral adapter. Server-side only; key never reaches the client. */
export async function callMistral(
  system: string,
  input: string,
  model: string,
): Promise<ProviderResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("mistral");

  const client = new OpenAI({ apiKey, baseURL: MISTRAL_BASE_URL });

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
      throw new ProviderError("mistral", `Mistral request failed: ${error.message}`);
    }
    throw new ProviderError(
      "mistral",
      error instanceof Error ? error.message : "Unknown Mistral error.",
    );
  }
}

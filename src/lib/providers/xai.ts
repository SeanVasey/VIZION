import "server-only";
import OpenAI from "openai";
import { parseEnhancePayload } from "@/lib/providers/formatters";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderResult,
} from "@/lib/providers/errors";

/** xAI's API is OpenAI-compatible, so the adapter is the OpenAI SDK pointed
 *  at api.x.ai — no extra dependency. */
const XAI_BASE_URL = "https://api.x.ai/v1";

/** xAI (Grok) adapter. Server-side only; key never reaches the client. */
export async function callXAI(
  system: string,
  input: string,
  model: string,
): Promise<ProviderResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("xai");

  const client = new OpenAI({ apiKey, baseURL: XAI_BASE_URL });

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
      throw new ProviderError("xai", `Grok request failed: ${error.message}`);
    }
    throw new ProviderError(
      "xai",
      error instanceof Error ? error.message : "Unknown Grok error.",
    );
  }
}

import "server-only";
import { parseEnhancePayload } from "@/lib/providers/formatters";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderResult,
} from "@/lib/providers/errors";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
}

/**
 * Google (Gemini) adapter via the stable generateContent REST endpoint. Server-
 * side only; key never reaches the client. Uses the system-instruction + parts
 * structuring Gemini favors, with a JSON response MIME type.
 */
export async function callGoogle(
  system: string,
  input: string,
  model: string,
): Promise<ProviderResult> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("google");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: input }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });

    const data = (await res.json()) as GeminiResponse;
    if (!res.ok) {
      throw new ProviderError(
        "google",
        `Gemini request failed: ${data.error?.message ?? res.statusText}`,
      );
    }

    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");

    return {
      ...parseEnhancePayload(text),
      tokenIn: data.usageMetadata?.promptTokenCount ?? 0,
      tokenOut: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } catch (error) {
    if (error instanceof ProviderError || error instanceof ProviderNotConfiguredError) {
      throw error;
    }
    throw new ProviderError(
      "google",
      error instanceof Error ? error.message : "Unknown Gemini error.",
    );
  }
}

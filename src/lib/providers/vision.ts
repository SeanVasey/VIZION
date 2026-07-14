import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { TargetModelId } from "@/lib/constants";
import { TARGETS, type Provider } from "@/lib/providers/config";
import { ProviderError, ProviderNotConfiguredError } from "@/lib/providers/errors";
import { MEDIA_EXTRACT_SYSTEM, parseMediaAttributes } from "@/lib/media/extract";
import type { MediaAttributes } from "@/lib/media/types";

/**
 * Vision analysis by the user's SELECTED target model — one `describeImage`
 * fanning out per provider, mirroring the enhance adapter. Every path sends
 * MEDIA_EXTRACT_SYSTEM and parses the same JSON (attributes + the prose
 * `description` for the media content box). Server-side only.
 */

export interface VisionResult {
  attrs: Partial<MediaAttributes>;
  tokenIn: number;
  tokenOut: number;
}

const USER_TEXT = "Extract the attributes as JSON.";

type AnthropicImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

async function describeAnthropic(
  base64: string,
  mediaType: string,
  model: string,
): Promise<VisionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("anthropic");

  const client = new Anthropic({ apiKey });
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
          { type: "text", text: USER_TEXT },
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
}

/** OpenAI, xAI, and Mistral all take an image_url content part. */
async function describeOpenAICompatible(
  apiKey: string,
  baseURL: string | undefined,
  base64: string,
  mediaType: string,
  model: string,
): Promise<VisionResult> {
  const client = new OpenAI({ apiKey, baseURL });
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: MEDIA_EXTRACT_SYSTEM },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mediaType};base64,${base64}` },
          },
          { type: "text", text: USER_TEXT },
        ],
      },
    ],
  });
  return {
    attrs: parseMediaAttributes(response.choices[0]?.message?.content ?? ""),
    tokenIn: response.usage?.prompt_tokens ?? 0,
    tokenOut: response.usage?.completion_tokens ?? 0,
  };
}

interface GeminiVisionResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
}

async function describeGoogle(
  base64: string,
  mediaType: string,
  model: string,
): Promise<VisionResult> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("google");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: MEDIA_EXTRACT_SYSTEM }] },
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mediaType, data: base64 } },
            { text: USER_TEXT },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  const data = (await res.json()) as GeminiVisionResponse;
  if (!res.ok) {
    throw new ProviderError(
      "google",
      `Gemini vision request failed: ${data.error?.message ?? res.statusText}`,
      res.status,
    );
  }
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
  return {
    attrs: parseMediaAttributes(text),
    tokenIn: data.usageMetadata?.promptTokenCount ?? 0,
    tokenOut: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

const PROVIDER_KEY_ENV: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  mistral: "MISTRAL_API_KEY",
  xai: "XAI_API_KEY",
};

/** Fallback priority when the selected model can't run vision — the original
 *  design analyzed on Opus, so Anthropic stays first. */
const VISION_FALLBACK_ORDER: readonly TargetModelId[] = [
  "opus_4_8",
  "gpt_5_6_sol",
  "gemini_3_5_thinking",
  "mistral_large_3",
  "grok_4_5",
];

/**
 * A failure the deployment (not the image) caused: missing key, a key the
 * provider rejects (401/403 — e.g. a restricted key without model access), or
 * an unknown model string (404). These are worth retrying on another provider;
 * 4xx about the request itself or 5xx transients are not.
 */
export function isVisionConfigError(error: unknown): boolean {
  if (error instanceof ProviderNotConfiguredError) return true;
  return (
    error instanceof ProviderError &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  );
}

/** First fallback target on a *different* provider that has a key configured,
 *  or null when the failed provider is the only one available. */
export function visionFallbackTarget(failed: TargetModelId): TargetModelId | null {
  const failedProvider = TARGETS[failed].provider;
  for (const target of VISION_FALLBACK_ORDER) {
    const provider = TARGETS[target].provider;
    if (provider === failedProvider) continue;
    if (process.env[PROVIDER_KEY_ENV[provider]]) return target;
  }
  return null;
}

/** Analyze an image with the given target model's provider. */
export async function describeImage(
  base64: string,
  mediaType: string,
  target: TargetModelId,
): Promise<VisionResult> {
  const cfg = TARGETS[target];
  const requireKey = (env: string) => {
    const key = process.env[env];
    if (!key) throw new ProviderNotConfiguredError(cfg.provider);
    return key;
  };

  try {
    switch (cfg.provider) {
      case "anthropic":
        return await describeAnthropic(base64, mediaType, cfg.model);
      case "openai":
        return await describeOpenAICompatible(
          requireKey("OPENAI_API_KEY"),
          undefined,
          base64,
          mediaType,
          cfg.model,
        );
      case "xai":
        return await describeOpenAICompatible(
          requireKey("XAI_API_KEY"),
          "https://api.x.ai/v1",
          base64,
          mediaType,
          cfg.model,
        );
      case "mistral":
        return await describeOpenAICompatible(
          requireKey("MISTRAL_API_KEY"),
          "https://api.mistral.ai/v1",
          base64,
          mediaType,
          cfg.model,
        );
      case "google":
        return await describeGoogle(base64, mediaType, cfg.model);
    }
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError || error instanceof ProviderError) {
      throw error;
    }
    if (error instanceof Anthropic.APIError || error instanceof OpenAI.APIError) {
      throw new ProviderError(
        cfg.provider,
        `Vision request failed: ${error.message}`,
        error.status,
      );
    }
    throw new ProviderError(
      cfg.provider,
      error instanceof Error ? error.message : "Unknown vision error.",
    );
  }
}

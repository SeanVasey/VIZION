import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { TargetModelId } from "@/lib/constants";
import {
  TARGETS,
  PROVIDER_KEY_ENV,
  PROVIDER_MAX_RETRIES,
  MEDIA_TIMEOUT_MS,
  type Provider,
} from "@/lib/providers/config";
import { ProviderError, ProviderNotConfiguredError } from "@/lib/providers/errors";
import {
  MEDIA_EXTRACT_SYSTEM,
  parseMediaAttributes,
  parseMediaText,
} from "@/lib/media/extract";
import type { MediaAttributes } from "@/lib/media/types";

/**
 * Vision analysis by the user's SELECTED target model — one `describeImage`
 * fanning out per provider, mirroring the enhance adapter. The system prompt
 * and expected response shape vary by analysis INTENT (attribute extraction,
 * style-only, faithful transcription) — every provider path sends the same
 * spec and the parse happens once at the tail. Server-side only.
 */

export interface VisionResult {
  attrs: Partial<MediaAttributes>;
  /** Transcription — present only for `expect: "text"` analyses. */
  text?: string;
  tokenIn: number;
  tokenOut: number;
  /** The provider omitted usage, so the zero counts are a default, not a
   *  measurement — surfaced so cost is never displayed as exact (INV-04). */
  usageEstimated?: boolean;
}

export interface VisionOptions {
  /** System prompt override (defaults to MEDIA_EXTRACT_SYSTEM). */
  system?: string;
  /** What the response parses as (defaults to "attributes"). */
  expect?: "attributes" | "text";
}

interface VisionSpec {
  system: string;
  userText: string;
}

/** Raw provider response — parsed once by describeImage. */
interface RawVision {
  raw: string;
  tokenIn: number;
  tokenOut: number;
  /** True when the response carried no usage block (counts defaulted to 0). */
  usageEstimated?: boolean;
}

type AnthropicImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

async function describeAnthropic(
  base64: string,
  mediaType: string,
  model: string,
  spec: VisionSpec,
): Promise<RawVision> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("anthropic");

  const client = new Anthropic({
    apiKey,
    timeout: MEDIA_TIMEOUT_MS,
    maxRetries: PROVIDER_MAX_RETRIES,
  });
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: spec.system,
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
          { type: "text", text: spec.userText },
        ],
      },
    ],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    raw: text,
    tokenIn: response.usage.input_tokens,
    tokenOut: response.usage.output_tokens,
  };
}

/** OpenAI, xAI, and Mistral all take an image_url content part.
 *  Parity with the sibling paths (Anthropic caps at 1024; Gemini pins JSON):
 *  enforce json_object and cap the output. The cap field differs per API —
 *  OpenAI wants max_completion_tokens, while Mistral 422s on unknown fields
 *  and (like xAI) takes classic max_tokens — so the caller picks it. */
async function describeOpenAICompatible(
  apiKey: string,
  baseURL: string | undefined,
  base64: string,
  mediaType: string,
  model: string,
  spec: VisionSpec,
  tokenCap: { max_tokens: number } | { max_completion_tokens: number },
  // Perplexity takes json_schema, not json_object (and Meta keeps the same
  // conservative carve-out on the new Meta Model API) — for those the prompt
  // alone pins JSON and the tolerant parsers absorb a miss.
  jsonMode = true,
): Promise<RawVision> {
  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout: MEDIA_TIMEOUT_MS,
    maxRetries: PROVIDER_MAX_RETRIES,
  });
  const response = await client.chat.completions.create({
    model,
    ...tokenCap,
    ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    messages: [
      { role: "system", content: spec.system },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mediaType};base64,${base64}` },
          },
          { type: "text", text: spec.userText },
        ],
      },
    ],
  });
  return {
    raw: response.choices[0]?.message?.content ?? "",
    tokenIn: response.usage?.prompt_tokens ?? 0,
    tokenOut: response.usage?.completion_tokens ?? 0,
    ...(response.usage ? {} : { usageEstimated: true }),
  };
}

interface GeminiVisionResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    /** Thinking-model reasoning tokens — billed as output. */
    thoughtsTokenCount?: number;
  };
  error?: { message?: string };
}

async function describeGoogle(
  base64: string,
  mediaType: string,
  model: string,
  spec: VisionSpec,
): Promise<RawVision> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("google");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    // Raw fetch — bounded like the SDK clients (PRV-002).
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: spec.system }] },
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mediaType, data: base64 } },
            { text: spec.userText },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  // Parse defensively — a gateway can answer 401/403/404 with a non-JSON body,
  // and a parse throw here would lose the status the fallback keys off.
  let data: GeminiVisionResponse = {};
  try {
    data = (await res.json()) as GeminiVisionResponse;
  } catch {
    /* non-JSON body — fall through to the status check */
  }
  if (!res.ok) {
    // Some Gemini failures (e.g. a mid-generation policy stop) still report
    // usageMetadata — carry it so the route can bill what actually ran.
    const meta = data.usageMetadata;
    throw new ProviderError(
      "google",
      `Gemini vision request failed: ${data.error?.message ?? res.statusText}`,
      res.status,
      meta
        ? {
            tokenIn: meta.promptTokenCount ?? 0,
            tokenOut:
              (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
          }
        : undefined,
    );
  }
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
  return {
    raw: text,
    tokenIn: data.usageMetadata?.promptTokenCount ?? 0,
    // Thinking tokens are billed as output — dropping them undercounts the cap.
    tokenOut:
      (data.usageMetadata?.candidatesTokenCount ?? 0) +
      (data.usageMetadata?.thoughtsTokenCount ?? 0),
    ...(data.usageMetadata ? {} : { usageEstimated: true }),
  };
}

/** Fallback priority when the selected model can't run vision — the original
 *  design analyzed on Opus, so Anthropic stays first. */
const VISION_FALLBACK_ORDER: readonly TargetModelId[] = [
  "opus_5",
  "gpt_5_6_sol",
  "gemini_3_6_flash",
  "mistral_large_3",
  "grok_4_5",
  "muse_spark_1_1",
  "kimi_k3",
  "sonar_pro",
];

/** Providers whose roster flagship takes image input. DeepSeek, MiniMax,
 *  Qwen Max, and GLM-5.2 are text-only flagships (their vision models are
 *  separate SKUs — e.g. Z.ai's glm-5v-turbo), so media analysis for those
 *  targets is routed to the fallback chain. */
const VISION_CAPABLE_PROVIDERS: ReadonlySet<Provider> = new Set([
  "anthropic",
  "openai",
  "google",
  "meta",
  "mistral",
  "moonshot",
  "perplexity",
  "xai",
]);

/** Whether the target's provider can analyze images at all — callers should
 *  route non-capable targets straight to `visionFallbackTarget`. */
export function supportsVision(target: TargetModelId): boolean {
  return VISION_CAPABLE_PROVIDERS.has(TARGETS[target].provider);
}

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

/** Analyze an image with the given target model's provider. `opts` selects
 *  the analysis intent (attribute extraction by default; style-only or
 *  faithful transcription via system/expect). */
export async function describeImage(
  base64: string,
  mediaType: string,
  target: TargetModelId,
  opts?: VisionOptions,
): Promise<VisionResult> {
  const cfg = TARGETS[target];
  const expect = opts?.expect ?? "attributes";
  const spec: VisionSpec = {
    system: opts?.system ?? MEDIA_EXTRACT_SYSTEM,
    userText:
      expect === "text"
        ? "Transcribe the legible text as JSON."
        : "Extract the attributes as JSON.",
  };
  const requireKey = (env: string) => {
    const key = process.env[env];
    if (!key) throw new ProviderNotConfiguredError(cfg.provider);
    return key;
  };
  const finish = (r: RawVision): VisionResult => ({
    ...(expect === "text"
      ? { attrs: {}, text: parseMediaText(r.raw) }
      : { attrs: parseMediaAttributes(r.raw) }),
    tokenIn: r.tokenIn,
    tokenOut: r.tokenOut,
    ...(r.usageEstimated ? { usageEstimated: true } : {}),
  });

  try {
    switch (cfg.provider) {
      case "anthropic":
        return finish(await describeAnthropic(base64, mediaType, cfg.model, spec));
      case "openai":
        // 4096, not 1024: reasoning-class models spend completion budget on
        // reasoning tokens first — a tight cap can be consumed before any
        // JSON is emitted, silently returning empty attributes.
        return finish(
          await describeOpenAICompatible(
            requireKey("OPENAI_API_KEY"),
            undefined,
            base64,
            mediaType,
            cfg.model,
            spec,
            { max_completion_tokens: 4096 },
          ),
        );
      case "xai":
        // Grok-class models reason unconditionally — same headroom as OpenAI.
        return finish(
          await describeOpenAICompatible(
            requireKey("XAI_API_KEY"),
            "https://api.x.ai/v1",
            base64,
            mediaType,
            cfg.model,
            spec,
            { max_tokens: 4096 },
          ),
        );
      case "mistral":
        return finish(
          await describeOpenAICompatible(
            requireKey("MISTRAL_API_KEY"),
            "https://api.mistral.ai/v1",
            base64,
            mediaType,
            cfg.model,
            spec,
            { max_tokens: 1024 },
          ),
        );
      case "meta":
        return finish(
          await describeOpenAICompatible(
            requireKey("META_API_KEY"),
            "https://api.meta.ai/v1",
            base64,
            mediaType,
            cfg.model,
            spec,
            { max_tokens: 1024 },
            false,
          ),
        );
      case "moonshot":
        return finish(
          await describeOpenAICompatible(
            requireKey("MOONSHOT_API_KEY"),
            "https://api.moonshot.ai/v1",
            base64,
            mediaType,
            cfg.model,
            spec,
            { max_tokens: 1024 },
          ),
        );
      case "perplexity":
        // Sonar reasons before answering — same headroom as OpenAI.
        return finish(
          await describeOpenAICompatible(
            requireKey("PERPLEXITY_API_KEY"),
            "https://api.perplexity.ai",
            base64,
            mediaType,
            cfg.model,
            spec,
            { max_tokens: 4096 },
            false,
          ),
        );
      case "google":
        return finish(await describeGoogle(base64, mediaType, cfg.model, spec));
      case "deepseek":
      case "minimax":
      case "qwen":
      case "zai":
        // Text-only flagships — callers gate on supportsVision() first, so
        // this is a defensive backstop, not a reachable user path.
        throw new ProviderError(
          cfg.provider,
          "The selected model can't analyze images.",
        );
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

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
import {
  ProviderError,
  ProviderNotConfiguredError,
  providerEffort,
} from "@/lib/providers/errors";
import { QWEN_BASE_URL } from "@/lib/providers/openai-compat";
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

interface VisionResult {
  attrs: Partial<MediaAttributes>;
  /** Transcription — present only for `expect: "text"` analyses. */
  text?: string;
  tokenIn: number;
  tokenOut: number;
  /** The provider omitted usage, so the zero counts are a default, not a
   *  measurement — surfaced so cost is never displayed as exact (INV-04). */
  usageEstimated?: boolean;
}

interface VisionOptions {
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

/** MiniMax M-series interleaves `<think>…</think>` reasoning inside `content`
 *  (the enhance adapter filters it chunk-by-chunk via `stripThink`). This is
 *  the buffered-response equivalent: drop closed spans, then anything after a
 *  dangling open tag — a truncated thought is never attribute JSON. */
function stripThinkSpans(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<think>[\s\S]*$/, "");
}

/**
 * Headroom for a one-shot image analysis on a REASONING model.
 *
 * Every vision-capable model on the roster now reasons, and most cannot
 * stop: reasoning is billed against the output cap first, so a cap sized for
 * the JSON alone can be spent before any JSON is written — which returns
 * empty attributes with no error (the lesson the OpenAI path learned first).
 * The 1024 caps this file carried for Anthropic, Mistral, Meta, Kimi and
 * Qwen were each sized when that model had no reasoning to pay for.
 */
const VISION_MAX_TOKENS = 4096;

async function describeAnthropic(
  base64: string,
  mediaType: string,
  model: string,
  spec: VisionSpec,
  effort?: string,
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
    max_tokens: VISION_MAX_TOKENS,
    // `output_config.effort` is the GA depth control; this SDK version's
    // types predate it and unknown body keys pass through (anthropic.ts).
    ...(effort ? ({ output_config: { effort } } as object) : {}),
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

/** Every OpenAI-compatible vision API takes an image_url content part.
 *  Parity with the sibling paths (Anthropic and Gemini): pin JSON where the
 *  API allows it and cap the output. The cap field differs per API —
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
  /** The model's own LOWEST effort word, when it has a knob (see
   *  describeImage). Omitted entirely otherwise — Mistral 422s on unknown
   *  fields, and a knob-less model must never be sent one. */
  effort: string | undefined,
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
    ...(effort ? ({ reasoning_effort: effort } as object) : {}),
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
  effort?: string,
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
      generationConfig: {
        responseMimeType: "application/json",
        ...(effort ? { thinkingConfig: { thinkingLevel: effort } } : {}),
      },
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
            tokenOut: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
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
 *  design analyzed on Opus, so Anthropic stays first. Sonar stays last: its
 *  answers are search-grounded, the least neutral lens for describing an
 *  image the user attached. */
const VISION_FALLBACK_ORDER: readonly TargetModelId[] = [
  "opus_5_5",
  "gpt_6_2_sol",
  "gemini_4_hydrogen",
  "mistral_large_4",
  "grok_4_7",
  "muse_spark_1_3",
  "kimi_k3_1_pro",
  "qwen4_max",
  "minimax_m3_1_flash",
  "sonar_pro",
];

/** Providers whose roster models take image input. DeepSeek V4 Pro and
 *  GLM-5.3 are text-only (their vision models are separate SKUs — DeepSeek's
 *  is `deepseek-flash`, Z.ai's `glm-5v-turbo`), so media analysis for those
 *  targets is routed to the fallback chain. Re-read 2026-11-28: every other
 *  roster model documents image input, including the four new slots. A
 *  provider-level set still holds because no provider mixes vision and
 *  text-only models on the roster — the day one does, this becomes per
 *  target like the effort vocabulary did. */
const VISION_CAPABLE_PROVIDERS: ReadonlySet<Provider> = new Set([
  "anthropic",
  "openai",
  "google",
  "meta",
  "minimax",
  "mistral",
  "moonshot",
  "perplexity",
  "qwen",
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
  // An image analysis is a bounded extraction under a 55s wall, not a
  // reasoning job: ask for the model's LOWEST effort rather than inheriting
  // a vendor default that is `high` on most of the roster and `max` on Kimi,
  // Muse Wonder and MiniMax. Translated through the same per-target
  // vocabulary the enhance path uses, so it is always a word this model
  // accepts; undefined for a model with no knob.
  const effort = cfg.effort ? providerEffort(cfg.effort, "low") : undefined;
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
        return finish(
          await describeAnthropic(base64, mediaType, cfg.model, spec, effort),
        );
      case "openai":
        // max_completion_tokens here, classic max_tokens everywhere else:
        // the cap FIELD differs per API (see describeOpenAICompatible).
        return finish(
          await describeOpenAICompatible(
            requireKey(PROVIDER_KEY_ENV[cfg.provider]),
            undefined,
            base64,
            mediaType,
            cfg.model,
            spec,
            { max_completion_tokens: VISION_MAX_TOKENS },
            effort,
          ),
        );
      case "xai":
        return finish(
          await describeOpenAICompatible(
            requireKey(PROVIDER_KEY_ENV[cfg.provider]),
            "https://api.x.ai/v1",
            base64,
            mediaType,
            cfg.model,
            spec,
            { max_tokens: VISION_MAX_TOKENS },
            effort,
          ),
        );
      case "mistral":
        return finish(
          await describeOpenAICompatible(
            requireKey(PROVIDER_KEY_ENV[cfg.provider]),
            "https://api.mistral.ai/v1",
            base64,
            mediaType,
            cfg.model,
            spec,
            { max_tokens: VISION_MAX_TOKENS },
            effort,
          ),
        );
      case "meta":
        return finish(
          await describeOpenAICompatible(
            requireKey(PROVIDER_KEY_ENV[cfg.provider]),
            "https://api.meta.ai/v1",
            base64,
            mediaType,
            cfg.model,
            spec,
            { max_tokens: VISION_MAX_TOKENS },
            effort,
            false,
          ),
        );
      case "moonshot":
        return finish(
          await describeOpenAICompatible(
            requireKey(PROVIDER_KEY_ENV[cfg.provider]),
            "https://api.moonshot.ai/v1",
            base64,
            mediaType,
            cfg.model,
            spec,
            { max_tokens: VISION_MAX_TOKENS },
            effort,
          ),
        );
      case "perplexity":
        // No effort word: the legacy Sonar chat endpoint documents none.
        return finish(
          await describeOpenAICompatible(
            requireKey(PROVIDER_KEY_ENV[cfg.provider]),
            "https://api.perplexity.ai",
            base64,
            mediaType,
            cfg.model,
            spec,
            { max_tokens: VISION_MAX_TOKENS },
            effort,
            false,
          ),
        );
      case "google":
        return finish(await describeGoogle(base64, mediaType, cfg.model, spec, effort));
      case "minimax": {
        // The M-series interleaves its reasoning INSIDE content, so the think
        // spans are stripped before the parse. Base URL and jsonMode mirror
        // `streamMiniMax` (openai-compat.ts).
        const r = await describeOpenAICompatible(
          requireKey(PROVIDER_KEY_ENV[cfg.provider]),
          "https://api.minimax.io/v1",
          base64,
          mediaType,
          cfg.model,
          spec,
          { max_tokens: VISION_MAX_TOKENS },
          effort,
        );
        return finish({ ...r, raw: stripThinkSpans(r.raw) });
      }
      case "qwen":
        // Model Studio's compatible-mode endpoint — the SAME (env-overridable)
        // base URL as `streamQwen`. Qwen4-Max thinks by default and its cap
        // covers thinking and answer together, so it gets the shared
        // headroom and the low effort word like everything else here.
        return finish(
          await describeOpenAICompatible(
            requireKey(PROVIDER_KEY_ENV[cfg.provider]),
            QWEN_BASE_URL,
            base64,
            mediaType,
            cfg.model,
            spec,
            { max_tokens: VISION_MAX_TOKENS },
            effort,
          ),
        );
      case "deepseek":
      case "zai":
        // Text-only flagships — callers gate on supportsVision() first, so
        // this is a defensive backstop, not a reachable user path.
        throw new ProviderError(cfg.provider, "The selected model can't analyze images.");
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

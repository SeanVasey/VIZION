import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  describeImage,
  isVisionConfigError,
  supportsVision,
  visionFallbackTarget,
} from "@/lib/providers/vision";
import { ProviderError, ProviderNotConfiguredError } from "@/lib/providers/errors";

const KEY_ENVS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "MISTRAL_API_KEY",
  "XAI_API_KEY",
  "LLAMA_API_KEY",
  "MOONSHOT_API_KEY",
  "PERPLEXITY_API_KEY",
] as const;

describe("isVisionConfigError", () => {
  it("flags a missing key and rejected/unknown-model provider statuses", () => {
    expect(isVisionConfigError(new ProviderNotConfiguredError("anthropic"))).toBe(true);
    expect(isVisionConfigError(new ProviderError("openai", "401 nope", 401))).toBe(true);
    expect(isVisionConfigError(new ProviderError("openai", "403 nope", 403))).toBe(true);
    expect(isVisionConfigError(new ProviderError("xai", "404 no model", 404))).toBe(true);
  });

  it("does not flag request/transient failures", () => {
    expect(isVisionConfigError(new ProviderError("openai", "400 bad image", 400))).toBe(
      false,
    );
    expect(isVisionConfigError(new ProviderError("openai", "429 slow down", 429))).toBe(
      false,
    );
    expect(isVisionConfigError(new ProviderError("google", "500 oops", 500))).toBe(false);
    expect(isVisionConfigError(new ProviderError("mistral", "no status"))).toBe(false);
    expect(isVisionConfigError(new Error("network"))).toBe(false);
  });
});

describe("ProviderError", () => {
  it("carries the upstream HTTP status", () => {
    const e = new ProviderError("openai", "401 insufficient permissions", 401);
    expect(e.status).toBe(401);
    expect(e.provider).toBe("openai");
  });
});

describe("visionFallbackTarget", () => {
  beforeEach(() => {
    // Start from a clean slate — empty string reads as "not configured".
    for (const k of KEY_ENVS) vi.stubEnv(k, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("picks the first configured target on a different provider", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("MISTRAL_API_KEY", "m-test");
    expect(visionFallbackTarget("fable_5")).toBe("gpt_5_6_sol");
  });

  it("prefers the Anthropic (Opus) fallback when available", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a-test");
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    expect(visionFallbackTarget("grok_4_5")).toBe("opus_5");
  });

  it("never falls back within the failed provider (same key would fail again)", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a-test");
    // fable_5 and opus_5 share the anthropic key — no other provider is up.
    expect(visionFallbackTarget("fable_5")).toBeNull();
    expect(visionFallbackTarget("opus_5")).toBeNull();
  });

  it("returns null when nothing is configured", () => {
    expect(visionFallbackTarget("gpt_5_6_sol")).toBeNull();
  });

  it("offers the new vision-capable providers as a last resort", () => {
    vi.stubEnv("MOONSHOT_API_KEY", "k-test");
    expect(visionFallbackTarget("minimax_m2_7")).toBe("kimi_k2_6");
  });
});

describe("supportsVision", () => {
  it("flags text-only flagships so the route can redirect up front", () => {
    expect(supportsVision("deepseek_v4")).toBe(false);
    expect(supportsVision("minimax_m2_7")).toBe(false);
    expect(supportsVision("qwen3_7_max")).toBe(false);
  });

  it("keeps the multimodal targets on their own provider", () => {
    expect(supportsVision("opus_5")).toBe(true);
    expect(supportsVision("sonnet_5")).toBe(true);
    expect(supportsVision("llama_4_maverick")).toBe(true);
    expect(supportsVision("kimi_k2_6")).toBe(true);
    expect(supportsVision("sonar_pro")).toBe(true);
  });
});

describe("describeImage — Gemini error bodies", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps the HTTP status when the error body isn't JSON (gateway HTML page)", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
      }),
    );

    let caught: unknown;
    try {
      await describeImage("AAAA", "image/png", "gemini_3_5_thinking");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    expect((caught as ProviderError).status).toBe(401);
    // The whole point: the fallback classifier must still see it as config-shaped.
    expect(isVisionConfigError(caught)).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isVisionConfigError, visionFallbackTarget } from "@/lib/providers/vision";
import { ProviderError, ProviderNotConfiguredError } from "@/lib/providers/errors";

const KEY_ENVS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "MISTRAL_API_KEY",
  "XAI_API_KEY",
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
    expect(visionFallbackTarget("grok_4_5")).toBe("opus_4_8");
  });

  it("never falls back within the failed provider (same key would fail again)", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a-test");
    // fable_5 and opus_4_8 share the anthropic key — no other provider is up.
    expect(visionFallbackTarget("fable_5")).toBeNull();
    expect(visionFallbackTarget("opus_4_8")).toBeNull();
  });

  it("returns null when nothing is configured", () => {
    expect(visionFallbackTarget("gpt_5_6_sol")).toBeNull();
  });
});

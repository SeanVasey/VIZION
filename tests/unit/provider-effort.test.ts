import { afterEach, describe, expect, it, vi } from "vitest";
import { THINKING_LADDER, THINKING_LEVELS } from "@/lib/constants";
import {
  describeProviderFailure,
  isDeepEffort,
  providerEffort,
  type EffortVocabulary,
} from "@/lib/providers/errors";
import { buildOpenAIParams } from "@/lib/providers/openai";
import { buildXAIParams } from "@/lib/providers/xai";

/**
 * The one translation table from the app's ladder onto every provider's
 * reasoning vocabulary (ADR-0018). Two properties are load-bearing and both
 * are pinned for EVERY vocabulary rather than spot-checked: the mapping is
 * monotone (a higher stop never sends a lower provider value), and the ends
 * are honest — Low is the provider's cheapest word, Max its costliest — so
 * the peak caption's "highest cost" is never a lie on a three-valued API.
 */
const VOCABULARIES: EffortVocabulary[] = ["five", "openai", "xai", "google", "three"];

/** Each vocabulary's words, cheapest first — the order the provider's own
 *  docs list them in. */
const RANK: Record<EffortVocabulary, string[]> = {
  five: ["low", "medium", "high", "xhigh", "max"],
  openai: ["low", "medium", "high", "xhigh", "max"],
  xai: ["low", "medium", "high", "xhigh"],
  google: ["low", "medium", "high"],
  three: ["low", "high", "max"],
};

describe("providerEffort", () => {
  it("sends nothing for Auto", () => {
    for (const v of VOCABULARIES) expect(providerEffort(v, undefined)).toBeUndefined();
  });

  it.each(VOCABULARIES)("%s: only ever emits a word the provider accepts", (v) => {
    for (const level of THINKING_LEVELS) {
      expect(RANK[v], `${v}/${level}`).toContain(providerEffort(v, level));
    }
  });

  it.each(VOCABULARIES)("%s: is monotone up the ladder", (v) => {
    let last = -1;
    for (const level of THINKING_LADDER) {
      const rank = RANK[v].indexOf(providerEffort(v, level)!);
      expect(rank, `${v}/${level}`).toBeGreaterThanOrEqual(last);
      last = rank;
    }
  });

  it.each(VOCABULARIES)(
    "%s: keeps the ends honest — Low cheapest, Max costliest",
    (v) => {
      expect(providerEffort(v, "low")).toBe(RANK[v][0]);
      expect(providerEffort(v, "max")).toBe(RANK[v][RANK[v].length - 1]);
    },
  );

  it("pins the per-provider collapses", () => {
    // Three-valued APIs (DeepSeek, Kimi, GLM): Medium lands on the middle
    // word, which is their `high`.
    expect(providerEffort("three", "medium")).toBe("high");
    // Gemini 3.8: no xhigh, no minimal.
    expect(providerEffort("google", "max")).toBe("high");
    expect(providerEffort("google", "minimal")).toBe("low");
    // Grok 4.6: xhigh is its top.
    expect(providerEffort("xai", "max")).toBe("xhigh");
    // Anthropic and OpenAI serve xhigh as its own tier, so a legacy xhigh
    // rides through rather than folding onto high.
    expect(providerEffort("five", "xhigh")).toBe("xhigh");
    expect(providerEffort("openai", "xhigh")).toBe("xhigh");
  });
});

describe("isDeepEffort", () => {
  it("is the two top ladder stops (and the legacy xhigh), nothing else", () => {
    expect(isDeepEffort(undefined)).toBe(false);
    expect(isDeepEffort("minimal")).toBe(false);
    expect(isDeepEffort("low")).toBe(false);
    expect(isDeepEffort("medium")).toBe(false);
    expect(isDeepEffort("high")).toBe(true);
    expect(isDeepEffort("xhigh")).toBe(true);
    expect(isDeepEffort("max")).toBe(true);
  });
});

describe("first-party request builders carry the translated word", () => {
  it("OpenAI: max and xhigh ride the wire, and the deep tier gets headroom", () => {
    expect(buildOpenAIParams("gpt-6-astra", "s", "i", "max").reasoning_effort).toBe(
      "max",
    );
    expect(buildOpenAIParams("gpt-5.6-sol", "s", "i", "max").max_completion_tokens).toBe(
      32_000,
    );
    expect(buildOpenAIParams("gpt-5.6-sol", "s", "i", "low").max_completion_tokens).toBe(
      16_000,
    );
    expect("reasoning_effort" in buildOpenAIParams("gpt-5.6-sol", "s", "i")).toBe(false);
  });

  it("xAI: Max lands on xhigh — Grok 4.6's top — with the deep headroom", () => {
    expect(buildXAIParams("grok-4.6", "s", "i", "max").reasoning_effort).toBe("xhigh");
    expect(buildXAIParams("grok-4.6", "s", "i", "max").max_tokens).toBe(32_000);
    expect(buildXAIParams("grok-4.6", "s", "i", "medium").max_tokens).toBe(16_000);
  });
});

describe("describeProviderFailure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the key and the env var on a 401/403 — the 'no body' screenshot", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const msg = describeProviderFailure(
      "mistral",
      "Mistral",
      "MISTRAL_API_KEY",
      401,
      "401 status code (no body)",
    );
    expect(msg).toContain("Mistral request failed: 401 status code (no body)");
    expect(msg).toContain("MISTRAL_API_KEY");
    expect(msg).toMatch(/refused the server's API key/);
    expect(console.warn).toHaveBeenCalledWith(
      "[mistral] upstream error",
      401,
      expect.any(String),
    );
  });

  it("points a 404 at the MODEL_* override, not the key", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const msg = describeProviderFailure(
      "zai",
      "GLM",
      "ZAI_API_KEY",
      404,
      "model not found",
    );
    expect(msg).toContain("MODEL_*");
    expect(msg).not.toContain("refused the server's API key");
  });

  it("relays every other status bare", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(describeProviderFailure("openai", "GPT", "OPENAI_API_KEY", 500, "boom")).toBe(
      "GPT request failed: boom",
    );
    expect(
      describeProviderFailure("openai", "GPT", "OPENAI_API_KEY", undefined, "boom"),
    ).toBe("GPT request failed: boom");
  });
});

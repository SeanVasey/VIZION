import { describe, expect, it } from "vitest";
import { buildCompatBody } from "@/lib/providers/openai-compat";

/**
 * The OpenAI-compatible request body. Three facts are pinned here because
 * each shipped wrong and failed (or crippled) EVERY call to its provider:
 *
 * - The output ceiling is a per-API fact. DashScope capped qwen3.7-max at
 *   8192 and 400'd above it, so the shared 16k default made every Qwen run
 *   fail; qwen3.8-max publishes 131,072, so the 8192 carried into 2026-09
 *   was the opposite mistake — truncating every deep run for no reason.
 * - Qwen's reasoning knob is a token BUDGET (`enable_thinking` +
 *   `thinking_budget`), not an effort word — and "Max" in Qwen3.8 Max is the
 *   model tier, not a thinking level.
 * - DeepSeek, Kimi K3 and GLM-5.3 take a three-valued `reasoning_effort`
 *   (low · high · max) that DEFAULTS to max on two of them; the app's four
 *   -stop ladder is translated onto it by `providerEffort("three")`.
 */
const BASE = {
  provider: "moonshot" as const,
  label: "Kimi",
  keyEnv: "MOONSHOT_API_KEY",
  baseURL: "https://api.moonshot.ai/v1",
};

const QWEN = {
  provider: "qwen" as const,
  label: "Qwen",
  keyEnv: "DASHSCOPE_API_KEY",
  baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  maxTokens: 32_000,
  thinkingBudget: { low: 1_024, medium: 4_096, high: 8_192, max: 16_000 },
};

const THREE = {
  provider: "moonshot" as const,
  label: "Kimi",
  keyEnv: "MOONSHOT_API_KEY",
  baseURL: "https://api.moonshot.ai/v1",
  effort: "three" as const,
  deepMaxTokens: 32_000,
};

describe("buildCompatBody", () => {
  it("carries the system prompt, the user input, and the model", () => {
    const body = buildCompatBody(BASE, "SYS", "INPUT", "kimi-k3");
    expect(body.model).toBe("kimi-k3");
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "INPUT" },
    ]);
    expect(body.stream).toBe(true);
  });

  it("defaults the output ceiling to 16k", () => {
    expect(buildCompatBody(BASE, "s", "i", "kimi-k3").max_tokens).toBe(16_000);
  });

  it("honours a provider's own ceiling", () => {
    // Every value outside the served range 400s on EVERY call, so the
    // ceiling is the provider's declared fact, never the shared default.
    expect(buildCompatBody(QWEN, "s", "i", "qwen-max").max_tokens).toBe(32_000);
  });

  it("gives the deep tier its own headroom only where the provider declares it", () => {
    // Reasoning bills against the ceiling (the Anthropic lesson): high/max
    // get deepMaxTokens, low/medium keep the ordinary ceiling.
    expect(
      buildCompatBody(THREE, "s", "i", "kimi-k3", { thinkingLevel: "max" }).max_tokens,
    ).toBe(32_000);
    expect(
      buildCompatBody(THREE, "s", "i", "kimi-k3", { thinkingLevel: "low" }).max_tokens,
    ).toBe(16_000);
    // No declaration → the deep tier stays at the ordinary ceiling.
    expect(
      buildCompatBody(BASE, "s", "i", "kimi-k3", { thinkingLevel: "max" }).max_tokens,
    ).toBe(16_000);
  });

  it("asks for JSON mode unless the API rejects it", () => {
    expect(buildCompatBody(BASE, "s", "i", "kimi-k3").response_format).toEqual({
      type: "json_object",
    });
    const noJson = buildCompatBody({ ...BASE, jsonMode: false }, "s", "i", "sonar-pro");
    expect("response_format" in noJson).toBe(false);
  });

  it("sends no thinking pair on the Auto path", () => {
    const body = buildCompatBody(QWEN, "s", "i", "qwen-max");
    expect("enable_thinking" in body).toBe(false);
    expect("thinking_budget" in body).toBe(false);
  });

  it("maps each level onto its thinking budget", () => {
    for (const [level, budget] of Object.entries(QWEN.thinkingBudget)) {
      const body = buildCompatBody(QWEN, "s", "i", "qwen-max", {
        thinkingLevel: level as "low",
      });
      expect(body.enable_thinking).toBe(true);
      expect(body.thinking_budget).toBe(budget);
    }
  });

  it("keeps every budget clear of the output ceiling", () => {
    // Reasoning bills against the same ceiling; a budget at or near it leaves
    // nothing for the JSON envelope, which surfaces as the adapter's
    // "hit its length limit" error instead of a result.
    for (const budget of Object.values(QWEN.thinkingBudget)) {
      expect(budget).toBeLessThanOrEqual(QWEN.maxTokens / 2);
    }
  });

  it("folds the legacy wire stops onto the ladder before reading the budget table", () => {
    // A pre-2026-09 draft can still carry `xhigh` or `minimal`; the budget
    // table is keyed by the four ladder stops.
    expect(
      buildCompatBody(QWEN, "s", "i", "qwen-max", { thinkingLevel: "xhigh" })
        .thinking_budget,
    ).toBe(QWEN.thinkingBudget.high);
    expect(
      buildCompatBody(QWEN, "s", "i", "qwen-max", { thinkingLevel: "minimal" })
        .thinking_budget,
    ).toBe(QWEN.thinkingBudget.low);
  });

  it("ignores a level on a provider with neither a budget table nor an effort word", () => {
    // The knob is per provider: a level that rides in from a stale client must
    // not invent a parameter the API would reject.
    const body = buildCompatBody(BASE, "s", "i", "kimi-k3", { thinkingLevel: "high" });
    expect("enable_thinking" in body).toBe(false);
    expect("reasoning_effort" in body).toBe(false);
  });

  it("translates the ladder onto a three-valued reasoning_effort", () => {
    // low · high · max: the ends stay honest (Low is cheapest, Max costs the
    // most) and Medium collapses onto the provider's middle value, `high`.
    const effortFor = (level: "low" | "medium" | "high" | "max") =>
      buildCompatBody(THREE, "s", "i", "kimi-k3", { thinkingLevel: level })
        .reasoning_effort;
    expect(effortFor("low")).toBe("low");
    expect(effortFor("medium")).toBe("high");
    expect(effortFor("high")).toBe("high");
    expect(effortFor("max")).toBe("max");
    // Auto sends nothing — the route resolves a level before it gets here,
    // and a bare call must not inherit the vendor's default-max by accident.
    expect("reasoning_effort" in buildCompatBody(THREE, "s", "i", "kimi-k3")).toBe(false);
  });
});

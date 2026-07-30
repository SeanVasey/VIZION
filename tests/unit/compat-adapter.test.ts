import { describe, expect, it } from "vitest";
import { buildCompatBody } from "@/lib/providers/openai-compat";

/**
 * The OpenAI-compatible request body. Two facts are pinned here because both
 * shipped wrong and both failed EVERY call to the provider they concern:
 *
 * - The output ceiling is a per-API fact. DashScope caps `max_tokens` at 8192
 *   and 400s above it, so the shared 16k default made every Qwen run fail with
 *   `InternalError.Algo.InvalidParameter`.
 * - Qwen's reasoning knob is a token BUDGET (`enable_thinking` +
 *   `thinking_budget`), not an effort word — and "Max" in Qwen3.7 Max is the
 *   model tier, not a thinking level.
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
  maxTokens: 8_192,
  thinkingBudget: { low: 512, medium: 1024, high: 2048, xhigh: 3072, max: 4096 },
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

  it("honours a provider's own lower ceiling", () => {
    // Above 8192 DashScope returns 400 "Range of max_tokens should be [1, 8192]".
    expect(buildCompatBody(QWEN, "s", "i", "qwen-max").max_tokens).toBe(8_192);
  });

  it("asks for JSON mode unless the API rejects it", () => {
    expect(buildCompatBody(BASE, "s", "i", "kimi-k3").response_format).toEqual({
      type: "json_object",
    });
    const noJson = buildCompatBody(
      { ...BASE, jsonMode: false },
      "s",
      "i",
      "sonar-pro",
    );
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

  it("ignores a level on a provider with no budget table", () => {
    // The knob is per provider: a level that rides in from a stale client must
    // not invent a parameter the API would reject.
    const body = buildCompatBody(BASE, "s", "i", "kimi-k3", { thinkingLevel: "high" });
    expect("enable_thinking" in body).toBe(false);
  });
});

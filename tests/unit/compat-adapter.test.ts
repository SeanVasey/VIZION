import { describe, expect, it } from "vitest";
import { buildCompatBody, qwenCeilings } from "@/lib/providers/openai-compat";

/**
 * The OpenAI-compatible request body. Three facts are pinned here because
 * each shipped wrong and failed (or crippled) EVERY call to its provider:
 *
 * - The output ceiling is a per-API fact. DashScope capped qwen3.7-max at
 *   8192 and 400'd above it, so the shared 16k default made every Qwen run
 *   fail; qwen3.8-max publishes 131,072, so the 8192 carried into 2026-09
 *   was the opposite mistake — truncating every deep run for no reason.
 * - Qwen's reasoning knob changed KIND. Through Qwen3.8 it was a token
 *   budget (`enable_thinking` + `thinking_budget`); Qwen4-Max takes an effort
 *   word (low · high · xhigh) and rejects the two together, so the budget
 *   pair must never reach the wire again. "Max" in Qwen4 Max is still the
 *   model tier, not a thinking level.
 * - DeepSeek, Kimi K3.1 Pro and GLM-5.3 take a three-valued `reasoning_effort`
 *   (low · high · max) that DEFAULTS to max on two of them; the app's four
 *   -stop ladder is translated onto it by `providerEffort("three")`.
 * - The vocabulary belongs to the TARGET, so a request can override the
 *   provider's fallback (`req.effortVocabulary`).
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
  deepMaxTokens: 64_000,
  effort: "threeX" as const,
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
    expect(buildCompatBody(QWEN, "s", "i", "qwen4-max").max_tokens).toBe(32_000);
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

  it("never sends Qwen's retired budget pair — Qwen4 rejects it beside an effort word", () => {
    for (const level of [undefined, "low", "medium", "high", "max"] as const) {
      const body = buildCompatBody(
        QWEN,
        "s",
        "i",
        "qwen4-max",
        level ? { thinkingLevel: level } : {},
      );
      expect("enable_thinking" in body).toBe(false);
      expect("thinking_budget" in body).toBe(false);
    }
  });

  it("translates the ladder onto Qwen4's low · high · xhigh", () => {
    const effortFor = (level: "low" | "medium" | "high" | "max" | "xhigh" | "minimal") =>
      buildCompatBody(QWEN, "s", "i", "qwen4-max", { thinkingLevel: level })
        .reasoning_effort;
    expect(effortFor("low")).toBe("low");
    expect(effortFor("medium")).toBe("high");
    expect(effortFor("high")).toBe("high");
    // Qwen4's top word is xhigh — never `max`, which it only maps.
    expect(effortFor("max")).toBe("xhigh");
    // A pre-2026-09 draft can still carry the legacy wire stops.
    expect(effortFor("xhigh")).toBe("xhigh");
    expect(effortFor("minimal")).toBe("low");
    expect("reasoning_effort" in buildCompatBody(QWEN, "s", "i", "qwen4-max")).toBe(
      false,
    );
  });

  it("gives Qwen's deep tier room for thinking AND the answer", () => {
    // Qwen4's cap covers chain-of-thought plus response, and with the budget
    // table gone nothing else bounds the thinking.
    expect(
      buildCompatBody(QWEN, "s", "i", "qwen4-max", { thinkingLevel: "max" }).max_tokens,
    ).toBe(64_000);
    expect(
      buildCompatBody(QWEN, "s", "i", "qwen4-max", { thinkingLevel: "low" }).max_tokens,
    ).toBe(32_000);
  });

  it("ignores a level on a provider with no effort vocabulary on either side", () => {
    // The knob is per target: a level that rides in from a stale client must
    // not invent a parameter the API would reject.
    const body = buildCompatBody(BASE, "s", "i", "sonar-pro", { thinkingLevel: "high" });
    expect("enable_thinking" in body).toBe(false);
    expect("reasoning_effort" in body).toBe(false);
  });

  it("lets the TARGET's vocabulary override the provider's fallback", () => {
    // What adapter.ts sends: `TARGETS[id].effort`. The factory's own `effort`
    // is only what a bare call falls back to.
    expect(
      buildCompatBody(THREE, "s", "i", "m", {
        thinkingLevel: "medium",
        effortVocabulary: "five",
      }).reasoning_effort,
    ).toBe("medium");
    expect(
      buildCompatBody(BASE, "s", "i", "m", {
        thinkingLevel: "max",
        effortVocabulary: "toHigh",
      }).reasoning_effort,
    ).toBe("high");
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

describe("MAX_TOKENS_QWEN", () => {
  it("caps the deep step too — an operator's ceiling is about what the scope serves", () => {
    // The override exists for accounts whose scope serves a LOWER range. A
    // deep step that ignored it would 400 every High/Max run on exactly
    // those accounts.
    expect(qwenCeilings(undefined)).toEqual({ maxTokens: 32_000, deepMaxTokens: 64_000 });
    expect(qwenCeilings(8192)).toEqual({ maxTokens: 8192, deepMaxTokens: 8192 });
  });
});

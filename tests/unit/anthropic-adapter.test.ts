import { describe, expect, it } from "vitest";
import { buildAnthropicParams } from "@/lib/providers/anthropic";

/**
 * The Anthropic token ladder (2026-07 incident): Claude 5 thinks by default
 * and bills thinking against max_tokens, so the UNSET-effort (Auto) path must
 * carry the same headroom as an explicit mid effort — a 16k default tier once
 * made Auto the tightest path in the fleet and truncated envelopes.
 */
describe("buildAnthropicParams", () => {
  it("gives the default (Auto) path 32k headroom and sends no output_config", () => {
    const p = buildAnthropicParams("claude-sonnet-5-5", "sys", "in");
    expect(p.max_tokens).toBe(32_000);
    expect("output_config" in p).toBe(false);
  });

  it("keeps low/medium/high at 32k with the effort on the wire", () => {
    for (const effort of ["low", "medium", "high"]) {
      const p = buildAnthropicParams("claude-sonnet-5-5", "sys", "in", effort);
      expect(p.max_tokens).toBe(32_000);
      expect(p.output_config).toEqual({ effort });
    }
  });

  it("gives the deep-reasoning efforts 64k", () => {
    for (const effort of ["xhigh", "max"]) {
      const p = buildAnthropicParams("claude-opus-5-5", "sys", "in", effort);
      expect(p.max_tokens).toBe(64_000);
      expect(p.output_config).toEqual({ effort });
    }
  });

  it("folds the legacy `minimal` onto low — Anthropic has no such effort", () => {
    const p = buildAnthropicParams("claude-sonnet-5-5", "sys", "in", "minimal");
    expect(p.output_config).toEqual({ effort: "low" });
    expect(p.max_tokens).toBe(32_000);
  });

  it("carries the system prompt and a single user message", () => {
    const p = buildAnthropicParams("claude-fable-5-2", "SYS", "INPUT");
    expect(p.system).toBe("SYS");
    expect(p.messages).toEqual([{ role: "user", content: "INPUT" }]);
    expect(p.model).toBe("claude-fable-5-2");
  });

  it("sends nothing the 5.5 generation rejects", () => {
    // Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5 each 400 on at least one
    // of these: an explicit thinking config other than adaptive (disabled or
    // a budget), sampling parameters, and forced tool choice. Depth is
    // `output_config.effort` and nothing else — pinned because every one of
    // these was a valid field two generations ago.
    for (const model of [
      "claude-fable-5-2",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]) {
      for (const effort of [undefined, "low", "medium", "high", "max"]) {
        const p: object = buildAnthropicParams(model, "sys", "in", effort);
        for (const banned of [
          "thinking",
          "temperature",
          "top_p",
          "top_k",
          "tool_choice",
          "tools",
        ]) {
          expect(banned in p, `${model}/${effort}/${banned}`).toBe(false);
        }
      }
    }
  });

  it("serves all five effort words to every Claude model on the roster", () => {
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      expect(
        buildAnthropicParams("claude-haiku-5-5", "s", "i", effort).output_config,
      ).toEqual({ effort });
    }
  });
});

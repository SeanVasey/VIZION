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
    const p = buildAnthropicParams("claude-sonnet-5", "sys", "in");
    expect(p.max_tokens).toBe(32_000);
    expect("output_config" in p).toBe(false);
  });

  it("keeps low/medium/high at 32k with the effort on the wire", () => {
    for (const effort of ["low", "medium", "high"]) {
      const p = buildAnthropicParams("claude-sonnet-5", "sys", "in", effort);
      expect(p.max_tokens).toBe(32_000);
      expect(p.output_config).toEqual({ effort });
    }
  });

  it("gives the deep-reasoning efforts 64k", () => {
    for (const effort of ["xhigh", "max"]) {
      const p = buildAnthropicParams("claude-opus-5", "sys", "in", effort);
      expect(p.max_tokens).toBe(64_000);
      expect(p.output_config).toEqual({ effort });
    }
  });

  it("carries the system prompt and a single user message", () => {
    const p = buildAnthropicParams("claude-fable-5", "SYS", "INPUT");
    expect(p.system).toBe("SYS");
    expect(p.messages).toEqual([{ role: "user", content: "INPUT" }]);
    expect(p.model).toBe("claude-fable-5");
  });
});

import { describe, it, expect } from "vitest";
import { buildSystemPrompt, parseEnhancePayload } from "@/lib/providers/formatters";

describe("buildSystemPrompt", () => {
  it("includes the mode instruction and target conventions", () => {
    const p = buildSystemPrompt("expand", "opus_4_8");
    expect(p).toContain("EXPAND");
    expect(p).toContain("Claude Opus");
    expect(p).toContain('"output"');
    expect(p).toContain('"rationale"');
  });

  it("targets GPT idioms for the GPT target", () => {
    expect(buildSystemPrompt("reformat", "gpt_5_5")).toContain("GPT");
  });

  it("targets Gemini idioms for the Gemini target", () => {
    expect(buildSystemPrompt("target", "gemini_pro_3_1")).toContain("Gemini");
  });

  it("polish preserves the input's shape and skips target restructuring idioms", () => {
    const p = buildSystemPrompt("polish", "opus_4_8");
    expect(p).toContain("POLISH");
    // No XML/structured idioms leak in for a shape-preserving mode.
    expect(p).not.toContain("XML-tagged");
    expect(p).not.toContain("Claude Opus");
    expect(p).toMatch(/preserve the input's existing format/i);
    expect(p).toMatch(/bullet points/i);
  });

  it("clarify no longer injects the target's structured-output idioms", () => {
    const p = buildSystemPrompt("clarify", "gpt_5_5");
    expect(p).not.toContain("JSON-mode");
    expect(p).toMatch(/preserve the input's existing format/i);
  });
});

describe("parseEnhancePayload", () => {
  it("parses a valid JSON payload and trims", () => {
    const out = parseEnhancePayload('{"output":"  hi  ","rationale":" why "}');
    expect(out).toEqual({ output: "hi", rationale: "why" });
  });

  it("throws on non-JSON", () => {
    expect(() => parseEnhancePayload("not json")).toThrow();
  });

  it("throws when fields are missing or wrong types", () => {
    expect(() => parseEnhancePayload('{"output":"x"}')).toThrow();
    expect(() => parseEnhancePayload('{"output":1,"rationale":"y"}')).toThrow();
  });
});

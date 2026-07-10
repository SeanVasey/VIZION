import { describe, it, expect } from "vitest";
import { buildSystemPrompt, parseEnhancePayload } from "@/lib/providers/formatters";
import { MODES, TARGET_MODELS } from "@/lib/constants";

describe("buildSystemPrompt", () => {
  it("includes the mode instruction and target conventions", () => {
    const p = buildSystemPrompt("expand", "opus_4_8");
    expect(p).toContain("EXPAND");
    expect(p).toContain("Claude Opus");
    expect(p).toContain('"output"');
    expect(p).toContain('"rationale"');
  });

  it("states the output-is-the-prompt contract for every mode × target", () => {
    for (const mode of MODES) {
      for (const target of TARGET_MODELS) {
        const p = buildSystemPrompt(mode.id, target.id);
        expect(p).toContain("THE OUTPUT IS THE PROMPT ITSELF");
        expect(p).toContain("Never produce role labels");
        expect(p).toContain(
          "Never write a system prompt, persona, or behavior spec",
        );
      }
    }
  });

  it("scopes the structure permission away from shape-preserving modes", () => {
    for (const target of TARGET_MODELS) {
      for (const mode of MODES) {
        const p = buildSystemPrompt(mode.id, target.id);
        const preserving = mode.id === "polish" || mode.id === "clarify";
        if (preserving) {
          // The permissive clause must not undercut FORMAT_PRESERVATION.
          expect(p).not.toContain("are fine inside that one prompt");
          expect(p).toContain("do not introduce sections, tags, or lists");
        } else {
          expect(p).toContain("are fine inside that one prompt");
          expect(p).not.toContain("do not introduce sections, tags, or lists");
        }
      }
    }
  });

  it("never instructs role framing that turns the output into a system prompt", () => {
    for (const mode of MODES) {
      for (const target of TARGET_MODELS) {
        const p = buildSystemPrompt(mode.id, target.id);
        expect(p).not.toContain("system/user separation");
        expect(p).not.toContain("developer/system/user role framing");
        expect(p).not.toContain("system-instruction block");
      }
    }
  });

  it("targets GPT idioms for the GPT target", () => {
    expect(buildSystemPrompt("reformat", "gpt_5_6_sol")).toContain("GPT");
  });

  it("targets Gemini idioms for the Gemini target", () => {
    expect(buildSystemPrompt("target", "gemini_3_5_thinking")).toContain("Gemini");
  });

  it("targets Fable idioms for the Fable target", () => {
    expect(buildSystemPrompt("expand", "fable_5")).toContain("Claude Fable");
  });

  it("targets Grok idioms for the Grok target", () => {
    expect(buildSystemPrompt("reformat", "grok_4_5")).toContain("Grok");
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
    const p = buildSystemPrompt("clarify", "gpt_5_6_sol");
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

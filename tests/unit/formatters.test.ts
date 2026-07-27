import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  parseEnhancePayload,
  REFINE_KINDS,
} from "@/lib/providers/formatters";
import { MODES, TARGET_MODELS } from "@/lib/constants";

describe("buildSystemPrompt", () => {
  it("includes the mode instruction and target conventions", () => {
    const p = buildSystemPrompt("expand", "opus_5");
    expect(p).toContain("EXPAND");
    expect(p).toContain("Claude Opus");
    expect(p).toContain('"output"');
    expect(p).toContain('"rationale"');
  });

  it("names the optional envelope fields and pins output first, every mode × target", () => {
    for (const mode of MODES) {
      for (const target of TARGET_MODELS) {
        const p = buildSystemPrompt(mode.id, target.id);
        expect(p).toContain('"assumptions" (optional');
        expect(p).toContain('"targetNotes" (optional');
        expect(p).toContain('"title" (optional');
        // The streaming scanner decodes the output field incrementally — the
        // contract must keep telling models to emit it first.
        expect(p).toContain('"output" MUST be the first field');
      }
    }
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
    expect(buildSystemPrompt("target", "gemini_3_6_flash")).toContain("Gemini");
  });

  it("targets Fable idioms for the Fable target", () => {
    expect(buildSystemPrompt("expand", "fable_5")).toContain("Claude Fable");
  });

  it("targets Grok idioms for the Grok target", () => {
    expect(buildSystemPrompt("reformat", "grok_4_5")).toContain("Grok");
  });

  it("polish preserves the input's shape and skips target restructuring idioms", () => {
    const p = buildSystemPrompt("polish", "opus_5");
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

  it("appends a refinement pass only when requested", () => {
    expect(buildSystemPrompt("condense", "opus_5")).not.toContain("REFINEMENT PASS");
    const p = buildSystemPrompt("condense", "opus_5", { kind: "shorter" });
    expect(p).toContain("REFINEMENT PASS");
    expect(p).toContain("meaningfully shorter");
  });

  it("the tone refinement wraps the author's original in delimiters", () => {
    const p = buildSystemPrompt("clarify", "opus_5", {
      kind: "tone",
      baseInput: "my casual original words",
    });
    expect(p).toContain("AUTHOR'S ORIGINAL:");
    expect(p).toContain("<original>\nmy casual original words\n</original>");
  });

  it("refinement never reintroduces role framing, any kind × mode", () => {
    for (const kind of REFINE_KINDS) {
      for (const mode of MODES) {
        const p = buildSystemPrompt(mode.id, "gpt_5_6_sol", { kind, baseInput: "x" });
        expect(p).toContain("THE OUTPUT IS THE PROMPT ITSELF");
        expect(p).not.toContain("system/user separation");
        expect(p).not.toContain("system-instruction block");
      }
    }
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

  it("passes through the optional fields when well-formed", () => {
    const out = parseEnhancePayload(
      JSON.stringify({
        output: "o",
        rationale: "r",
        assumptions: [" audience is technical ", "English output"],
        targetNotes: " Added XML sections for Opus. ",
        title: "  Concise summary prompt  ",
      }),
    );
    expect(out.assumptions).toEqual(["audience is technical", "English output"]);
    expect(out.targetNotes).toBe("Added XML sections for Opus.");
    expect(out.title).toBe("Concise summary prompt");
  });

  it("drops junk-shaped optional fields instead of failing the run", () => {
    const out = parseEnhancePayload(
      JSON.stringify({
        output: "o",
        rationale: "r",
        assumptions: [1, "", "  ", { no: true }],
        targetNotes: 42,
        title: "",
      }),
    );
    expect(out.assumptions).toBeUndefined();
    expect(out.targetNotes).toBeUndefined();
    expect(out.title).toBeUndefined();
  });

  it("caps assumptions at six and titles at sixty characters", () => {
    const out = parseEnhancePayload(
      JSON.stringify({
        output: "o",
        rationale: "r",
        assumptions: Array.from({ length: 10 }, (_, i) => `a${i}`),
        title: "x".repeat(100),
      }),
    );
    expect(out.assumptions).toHaveLength(6);
    expect(out.title).toHaveLength(60);
  });
});

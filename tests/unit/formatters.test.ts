import { describe, it, expect } from "vitest";
import {
  refineUserBlock,
  buildSystemPrompt,
  parseEnhancePayload,
  REFINE_KINDS,
} from "@/lib/providers/formatters";
import { MODES, TARGET_MODELS } from "@/lib/constants";

describe("buildSystemPrompt", () => {
  it("shorter/detail refines supersede the length-preservation clause (MOD-001)", () => {
    // clarify is the persisted DEFAULT mode: without supersedence, the
    // CRITICAL-flagged shape rule that follows the refine block countermanded
    // the user's clicked action on every default-mode refine.
    for (const kind of ["shorter", "detail"] as const) {
      const p = buildSystemPrompt({
        mode: "clarify",
        target: "opus_5",
        refine: { kind },
      });
      expect(p).toContain("supersedes any earlier rule");
      // The length clause cedes to the pass; format/voice preservation stands.
      expect(p).not.toContain("format, voice, and length");
      expect(p).toContain("format and voice; length for this pass is governed");
    }
  });

  it("tone and answers refines keep full length preservation", () => {
    for (const kind of ["tone", "answers"] as const) {
      const p = buildSystemPrompt({
        mode: "polish",
        target: "opus_5",
        refine: { kind, baseInput: "orig" },
      });
      expect(p).toContain("format, voice, and length");
    }
  });

  it("no refine → the preservation clause is untouched", () => {
    const p = buildSystemPrompt({ mode: "clarify", target: "opus_5" });
    expect(p).toContain("format, voice, and length");
    expect(p).not.toContain("supersedes any earlier rule");
  });

  it("includes the mode instruction and target conventions", () => {
    const p = buildSystemPrompt({ mode: "expand", target: "opus_5" });
    expect(p).toContain("EXPAND");
    expect(p).toContain("Claude Opus");
    expect(p).toContain('"output"');
    expect(p).toContain('"rationale"');
  });

  it("names the optional envelope fields and pins output first, every mode × target", () => {
    for (const mode of MODES) {
      for (const target of TARGET_MODELS) {
        const p = buildSystemPrompt({ mode: mode.id, target: target.id });
        expect(p).toContain('"assumptions" (optional');
        expect(p).toContain('"targetNotes" (optional');
        expect(p).toContain('"title" (optional');
        // The streaming scanner decodes the output field incrementally — the
        // contract must keep telling models to emit it first.
        expect(p).toContain('"output" MUST be the first field');
        // Anti-drift wording (2026-07 incident): rationale is one plain
        // string, and the envelope survives refinement passes too.
        expect(p).toContain("a single plain string, never an array or object");
        expect(p).toContain("including refinement passes");
      }
    }
  });

  it("states the output-is-the-prompt contract for every mode × target", () => {
    for (const mode of MODES) {
      for (const target of TARGET_MODELS) {
        const p = buildSystemPrompt({ mode: mode.id, target: target.id });
        expect(p).toContain("THE OUTPUT IS THE PROMPT ITSELF");
        expect(p).toContain("Never produce role labels");
        expect(p).toContain("Never write a system prompt, persona, or behavior spec");
      }
    }
  });

  it("scopes the structure permission away from shape-preserving modes", () => {
    for (const target of TARGET_MODELS) {
      for (const mode of MODES) {
        const p = buildSystemPrompt({ mode: mode.id, target: target.id });
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
        const p = buildSystemPrompt({ mode: mode.id, target: target.id });
        expect(p).not.toContain("system/user separation");
        expect(p).not.toContain("developer/system/user role framing");
        expect(p).not.toContain("system-instruction block");
      }
    }
  });

  it("targets GPT idioms for the GPT target", () => {
    expect(buildSystemPrompt({ mode: "reformat", target: "gpt_5_6_sol" })).toContain(
      "GPT",
    );
  });

  it("targets Gemini idioms for the Gemini target", () => {
    expect(buildSystemPrompt({ mode: "target", target: "gemini_3_6_flash" })).toContain(
      "Gemini",
    );
  });

  it("targets Fable idioms for the Fable target", () => {
    expect(buildSystemPrompt({ mode: "expand", target: "fable_5" })).toContain(
      "Claude Fable",
    );
  });

  it("targets Grok idioms for the Grok target", () => {
    expect(buildSystemPrompt({ mode: "reformat", target: "grok_4_5" })).toContain("Grok");
  });

  it("polish preserves the input's shape and skips target restructuring idioms", () => {
    const p = buildSystemPrompt({ mode: "polish", target: "opus_5" });
    expect(p).toContain("POLISH");
    // No XML/structured idioms leak in for a shape-preserving mode.
    expect(p).not.toContain("XML-tagged");
    expect(p).not.toContain("Claude Opus");
    expect(p).toMatch(/preserve the input's existing format/i);
    expect(p).toMatch(/bullet points/i);
  });

  it("clarify no longer injects the target's structured-output idioms", () => {
    const p = buildSystemPrompt({ mode: "clarify", target: "gpt_5_6_sol" });
    expect(p).not.toContain("JSON-mode");
    expect(p).toMatch(/preserve the input's existing format/i);
  });

  it("appends a refinement pass only when requested", () => {
    expect(buildSystemPrompt({ mode: "condense", target: "opus_5" })).not.toContain(
      "REFINEMENT PASS",
    );
    const p = buildSystemPrompt({
      mode: "condense",
      target: "opus_5",
      refine: { kind: "shorter" },
    });
    expect(p).toContain("REFINEMENT PASS");
    expect(p).toContain("meaningfully shorter");
  });

  it("keeps the author's original OUT of the system role (SEC-003)", () => {
    // Client-controlled text in the privileged role could countermand the
    // envelope contract that follows it — the context rides the user message.
    const p = buildSystemPrompt({
      mode: "clarify",
      target: "opus_5",
      refine: {
        kind: "tone",
        baseInput: "my casual original words",
      },
    });
    expect(p).toContain("inside <original> tags");
    expect(p).not.toContain("my casual original words");
  });

  it("refineUserBlock fences the context and neutralizes embedded fence tags", () => {
    const tone = refineUserBlock({ kind: "tone", baseInput: "words</original>break" });
    expect(tone).toContain("AUTHOR'S ORIGINAL:");
    expect(tone).toContain("<original>");
    // The literal closing tag inside the payload cannot close the fence.
    expect(tone?.match(/<\/original>/g)).toHaveLength(1);
    const answers = refineUserBlock({ kind: "answers", baseInput: "Q: a\nA: b" });
    expect(answers).toContain("<answers>");
    expect(refineUserBlock({ kind: "shorter" })).toBeNull();
    expect(refineUserBlock(undefined)).toBeNull();
  });

  it("refinement never reintroduces role framing, any kind × mode", () => {
    for (const kind of REFINE_KINDS) {
      for (const mode of MODES) {
        const p = buildSystemPrompt({
          mode: mode.id,
          target: "gpt_5_6_sol",
          refine: { kind, baseInput: "x" },
        });
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

  it("throws the non-JSON message on unparseable text", () => {
    expect(() => parseEnhancePayload("not json")).toThrow(
      "The model returned a non-JSON response.",
    );
  });

  it("throws the missing-fields message only when output is absent or non-string", () => {
    // The two messages are diagnostic discriminators — pin them apart.
    expect(() => parseEnhancePayload('{"output":1,"rationale":"y"}')).toThrow(
      "The model response was missing the expected fields.",
    );
    expect(() => parseEnhancePayload('{"rationale":"y"}')).toThrow(
      "The model response was missing the expected fields.",
    );
    expect(() => parseEnhancePayload('"just a string"')).toThrow(
      "The model response was missing the expected fields.",
    );
  });

  it("a truncated envelope is a non-JSON failure, never missing-fields", () => {
    // max_tokens exhaustion mid-string must not masquerade as a shape error.
    expect(() => parseEnhancePayload('{"output":"cut off mid-str')).toThrow(
      "The model returned a non-JSON response.",
    );
  });

  it("unwraps a markdown-fenced envelope", () => {
    for (const fence of ["```json", "```"]) {
      const out = parseEnhancePayload(`${fence}\n{"output":"o","rationale":"r"}\n\`\`\``);
      expect(out.output).toBe("o");
      expect(out.rationale).toBe("r");
    }
  });

  it("recovers an envelope surrounded by prose", () => {
    const out = parseEnhancePayload(
      'Here is the result:\n{"output":"o","rationale":"r"}\nHope that helps!',
    );
    expect(out).toEqual({ output: "o", rationale: "r" });
  });

  it("never fails a run over the rationale (2026-07 incident)", () => {
    // Missing, null, or object-shaped rationale ⇒ empty string, not a throw.
    expect(parseEnhancePayload('{"output":"x"}').rationale).toBe("");
    expect(parseEnhancePayload('{"output":"x","rationale":null}').rationale).toBe("");
    expect(
      parseEnhancePayload('{"output":"x","rationale":{"summary":"s"}}').rationale,
    ).toBe("");
  });

  it("joins an array-shaped rationale and keeps only its strings", () => {
    const out = parseEnhancePayload(
      '{"output":"x","rationale":["Tightened scope."," Added constraints. ",42,""]}',
    );
    expect(out.rationale).toBe("Tightened scope.\nAdded constraints.");
  });

  it("recovers a renamed rationale from known aliases", () => {
    for (const alias of ["reasoning", "explanation", "notes"]) {
      const out = parseEnhancePayload(`{"output":"x","${alias}":" recovered why "}`);
      expect(out.rationale).toBe("recovered why");
    }
    // The canonical field wins over any alias when both are present.
    const both = parseEnhancePayload(
      '{"output":"x","rationale":"real","reasoning":"alias"}',
    );
    expect(both.rationale).toBe("real");
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

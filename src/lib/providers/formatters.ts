import type { ModeId, TargetModelId } from "@/lib/constants";
import { MODE_INSTRUCTIONS } from "@/lib/enhance/modes";

/**
 * Per-target idiomatic conventions VIZ(IO)N applies (product-spec §4.3). The
 * target is both the engine that performs the rewrite AND the engine the result
 * is formatted for — each provider re-renders the prompt into its own idiom.
 */
const TARGET_CONVENTIONS: Record<TargetModelId, string> = {
  opus_4_8:
    "Target engine: Claude Opus. Favor XML-tagged sections (e.g. <task>, <context>, <constraints>, <examples>) and chain-of-thought scaffolds where reasoning helps, all inside the one prompt. Structure for long context.",
  gpt_5_5:
    "Target engine: GPT. Favor terse, directive instructions; where a machine-readable result is wanted, spell out the exact output format or schema inside the prompt.",
  gemini_pro_3_1:
    "Target engine: Gemini. Favor concrete, well-scoped instructions with explicit grounding — state what to use, what to avoid, and the expected output shape inside the prompt.",
};

/** Display labels (kept in sync with constants TARGET_MODELS). */
export const TARGET_LABEL: Record<TargetModelId, string> = {
  opus_4_8: "Opus 4.8",
  gpt_5_5: "GPT-5.5",
  gemini_pro_3_1: "Gemini Pro 3.1",
};

/**
 * Modes whose whole point is to stay close to the author's original wording and
 * shape. For these we must NOT apply the target engine's structural idioms
 * (XML sections, JSON specs, "parts" framing) — doing so is what turned a plain
 * prose prompt into a bulleted / heading-laden markdown document. Instead we
 * inject an explicit format-preservation rule.
 */
const SHAPE_PRESERVING = new Set<ModeId>(["polish", "clarify"]);

const FORMAT_PRESERVATION =
  'OUTPUT SHAPE — CRITICAL: This governs the transformed prompt only (the "output" field), not the JSON envelope you must return. Preserve the input\'s existing format, voice, and length. If the input is a single sentence or a plain paragraph, keep the output a single sentence or plain paragraph. Do NOT introduce bullet points, numbered lists, headings, tables, XML tags, JSON, or any markdown the author did not already use into the transformed prompt, and do NOT expand a short prose prompt into a structured document. The output will be pasted into the target engine — keep it clean, plain text unless the original was already structured.';

/**
 * The contract every mode's output must satisfy: the "output" field IS the
 * improved prompt — the single message the user pastes into the target
 * engine's message box. Without this, the target idioms above read as an
 * instruction to *script roles*, and the model returns a role-labelled system
 * prompt ("System: … / User message to respond to: …") instead of the
 * transformed prompt itself. The closing structure clause is chosen per mode
 * so the permissive wording never undercuts FORMAT_PRESERVATION for the
 * shape-preserving modes.
 */
const OUTPUT_CONTRACT_BASE =
  'THE OUTPUT IS THE PROMPT ITSELF: The "output" field must contain the improved prompt, written in the author\'s voice as the single message the user will paste into the target engine\'s message box. Never produce role labels or a role-scripted transcript (no "System:", "User:", "Assistant:", "Developer:" lines). Never write a system prompt, persona, or behavior spec for a hypothetical assistant. Never quote or embed the original input as a message to be responded to — transform the input itself.';

const OUTPUT_STRUCTURE_ALLOWED =
  "Sections, tags, or lists are fine inside that one prompt when the mode calls for structure.";

const OUTPUT_STRUCTURE_FORBIDDEN =
  "This mode preserves the input's shape — the OUTPUT SHAPE rule above stands: do not introduce sections, tags, or lists the author did not already use.";

/**
 * Build the system prompt that instructs the model to transform the user's
 * prompt for the given mode + target. Pure and deterministic so it can be
 * unit-tested and so the prompt prefix stays cache-friendly.
 */
export function buildSystemPrompt(mode: ModeId, target: TargetModelId): string {
  const shapePreserving = SHAPE_PRESERVING.has(mode);
  const conventions = shapePreserving ? FORMAT_PRESERVATION : TARGET_CONVENTIONS[target];
  const outputContract = `${OUTPUT_CONTRACT_BASE} ${
    shapePreserving ? OUTPUT_STRUCTURE_FORBIDDEN : OUTPUT_STRUCTURE_ALLOWED
  }`;
  return [
    "You are VIZ(IO)N, a precise prompt engineer. You transform a user's prompt; you never answer or execute it.",
    "",
    MODE_INSTRUCTIONS[mode],
    "",
    conventions,
    "",
    outputContract,
    "",
    "Return ONLY a JSON object with two string fields:",
    '- "output": the transformed prompt, ready to paste into the target engine.',
    '- "rationale": a short, plain-language explanation of what you changed and why (2-4 sentences).',
    "Do not wrap the JSON in markdown fences. Do not include any other text.",
  ].join("\n");
}

/** JSON schema describing the enhancement result, shared across providers. */
export const ENHANCE_SCHEMA = {
  type: "object",
  properties: {
    output: { type: "string", description: "The transformed prompt." },
    rationale: {
      type: "string",
      description: "Plain-language explanation of what changed and why.",
    },
  },
  required: ["output", "rationale"],
  additionalProperties: false,
} as const;

export interface EnhancePayload {
  output: string;
  rationale: string;
}

/** Parse + validate a provider's raw text response into the enhance payload. */
export function parseEnhancePayload(raw: string): EnhancePayload {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("The model returned a non-JSON response.");
  }
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as Record<string, unknown>).output !== "string" ||
    typeof (data as Record<string, unknown>).rationale !== "string"
  ) {
    throw new Error("The model response was missing the expected fields.");
  }
  const { output, rationale } = data as EnhancePayload;
  return { output: output.trim(), rationale: rationale.trim() };
}

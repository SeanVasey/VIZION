import type { ModeId, TargetModelId } from "@/lib/constants";
import { MODE_INSTRUCTIONS } from "@/lib/enhance/modes";

/**
 * Per-target idiomatic conventions VIZ(IO)N applies (product-spec §4.3). The
 * target is both the engine that performs the rewrite AND the engine the result
 * is formatted for — each provider re-renders the prompt into its own idiom.
 */
const TARGET_CONVENTIONS: Record<TargetModelId, string> = {
  opus_4_8:
    "Target engine: Claude Opus. Favor XML-tagged sections (e.g. <task>, <context>, <constraints>, <examples>), an explicit system/user separation, and chain-of-thought scaffolds where reasoning helps. Structure for long context.",
  gpt_5_5:
    "Target engine: GPT. Favor developer/system/user role framing, JSON-mode or structured-output specs where a machine-readable result is wanted, explicit tool/function schemas, and terse, directive system instructions.",
  gemini_pro_3_1:
    "Target engine: Gemini. Favor multimodal 'parts' structuring, a clear system-instruction block, and explicit grounding/safety framing. Keep instructions concrete and well-scoped.",
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
  "OUTPUT SHAPE — CRITICAL: Preserve the input's existing format, voice, and length. If the input is a single sentence or a plain paragraph, return a single sentence or plain paragraph. Do NOT introduce bullet points, numbered lists, headings, tables, XML tags, JSON, or any markdown the author did not already use, and do NOT expand a short prose prompt into a structured document. The result will still be pasted into the target engine — keep it clean, plain text unless the original was already structured.";

/**
 * Build the system prompt that instructs the model to transform the user's
 * prompt for the given mode + target. Pure and deterministic so it can be
 * unit-tested and so the prompt prefix stays cache-friendly.
 */
export function buildSystemPrompt(mode: ModeId, target: TargetModelId): string {
  const conventions = SHAPE_PRESERVING.has(mode)
    ? FORMAT_PRESERVATION
    : TARGET_CONVENTIONS[target];
  return [
    "You are VIZ(IO)N, a precise prompt engineer. You transform a user's prompt; you never answer or execute it.",
    "",
    MODE_INSTRUCTIONS[mode],
    "",
    conventions,
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

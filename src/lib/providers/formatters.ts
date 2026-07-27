import { TARGET_MODELS, type ModeId, type TargetModelId } from "@/lib/constants";
import { MODE_INSTRUCTIONS } from "@/lib/enhance/modes";

/**
 * Per-target idiomatic conventions VIZ(IO)N applies (product-spec §4.3). The
 * target is both the engine that performs the rewrite AND the engine the result
 * is formatted for — each provider re-renders the prompt into its own idiom.
 */
const TARGET_CONVENTIONS: Record<TargetModelId, string> = {
  opus_5:
    "Target engine: Claude Opus. Favor XML-tagged sections (e.g. <task>, <context>, <constraints>, <examples>) and chain-of-thought scaffolds where reasoning helps, all inside the one prompt. Structure for long context.",
  sonnet_5:
    "Target engine: Claude Sonnet. Favor clear, direct instructions with XML-tagged sections for layered context; state the goal, constraints, and expected output shape explicitly — this engine follows instructions literally and rewards precision over hint-dropping.",
  gpt_5_6_sol:
    "Target engine: GPT. Favor terse, directive instructions; where a machine-readable result is wanted, spell out the exact output format or schema inside the prompt.",
  gpt_5_6_luna:
    "Target engine: GPT. Favor terse, directive instructions with the goal stated first; where a machine-readable result is wanted, spell out the exact output format or schema inside the prompt — this balanced tier follows a crisp brief without heavy scaffolding.",
  gpt_5_6_terra:
    "Target engine: GPT. Keep the prompt short and self-contained with the goal and expected output format stated explicitly — this fast tier rewards brevity and concrete instructions over elaborate scaffolding.",
  fable_5:
    "Target engine: Claude Fable. State the goal, constraints, and what a finished answer looks like, and avoid over-prescriptive step-by-step scaffolding — this engine plans best from a clear brief. XML-tagged sections are welcome for long or layered context.",
  deepseek_v4:
    "Target engine: DeepSeek. State the problem plainly and completely up front, then let the engine reason — avoid prescribing step-by-step chains. Spell out the expected output format explicitly near the end of the prompt.",
  gemini_3_6_flash:
    "Target engine: Gemini. Favor concrete, well-scoped instructions with explicit grounding — state what to use, what to avoid, and the expected output shape inside the prompt. Keep the goal and the constraints in clearly separated blocks so the reasoning passes have something definite to work against.",
  muse_spark_1_1:
    "Target engine: Muse Spark. State the goal explicitly up front, enumerate requirements as numbered constraints, and put the output contract (format, length, done-criteria) near the top — this agentic engine executes a well-specified brief best and handles very long inline context.",
  minimax_m3:
    "Target engine: MiniMax. Favor a tight brief with the goal, constraints, and deliverable stated up front; keep instructions concrete and ordered — this agentic engine executes well-scoped plans best.",
  mistral_large_3:
    "Target engine: Mistral. Favor concise, explicit instructions with the context front-loaded and the expected output format stated inline; keep the prompt tight — this engine rewards economy over elaborate scaffolding.",
  kimi_k3:
    "Target engine: Kimi. State the goal and constraints clearly and front-load the key context — this long-context engine handles large pasted material well; make the deliverable and its format explicit.",
  sonar_pro:
    "Target engine: Perplexity Sonar. Phrase the prompt as a research brief: state what to find, the time window that matters, source expectations (e.g. cite sources), and the shape of the answer — this engine searches the web, so scoping and recency cues do real work.",
  qwen3_7_max:
    "Target engine: Qwen. Favor explicit, well-structured instructions with the task, context, and output format clearly separated; state language expectations when relevant — this engine is strong multilingually and rewards clean structure.",
  grok_4_5:
    "Target engine: Grok. Favor direct, plain-spoken instructions with the needed context stated inline; spell out the desired output format and any tone constraints inside the prompt.",
  glm_5_2:
    "Target engine: GLM. Favor structured, explicit specs — separate the task, context, constraints, and output format into clearly labeled parts and state acceptance criteria for code or reasoning work; this engine rewards complete, unambiguous specifications.",
};

/** Display labels — mechanically derived from TARGET_MODELS so a roster
 *  rename can't drift (the sibling TARGET_DEVELOPER map set the pattern). */
export const TARGET_LABEL: Record<TargetModelId, string> = Object.fromEntries(
  TARGET_MODELS.map((m) => [m.id, m.label]),
) as Record<TargetModelId, string>;

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
    // "output" first is load-bearing: the streaming scanner decodes the
    // output string incrementally, so a model that reorders fields only
    // delays streaming — it never breaks parsing.
    'Return ONLY a JSON object. Field order matters — "output" MUST be the first field:',
    '- "output" (required, string): the transformed prompt, ready to paste into the target engine.',
    '- "rationale" (required, string): a short, plain-language explanation of what you changed and why (2-4 sentences).',
    '- "assumptions" (optional, array of strings): assumptions you made to fill gaps in the request, one short line each. Omit the field entirely if you made none.',
    '- "targetNotes" (optional, string): one sentence naming any changes made specifically for the target engine. Omit if none.',
    '- "title" (optional, string): a short semantic name for this prompt (max 60 characters, no quotes), suitable as a library entry title.',
    "Do not wrap the JSON in markdown fences. Do not include any other text.",
  ].join("\n");
}

export interface EnhancePayload {
  output: string;
  rationale: string;
  /** Assumptions the model made to fill gaps — optional, capped, tolerant. */
  assumptions?: string[];
  /** One sentence on target-engine-specific changes — optional. */
  targetNotes?: string;
  /** Short semantic name for the prompt (library title seed) — optional. */
  title?: string;
}

/** Most assumptions a payload may carry — anything longer is noise. */
const MAX_ASSUMPTIONS = 6;
const MAX_TITLE_CHARS = 60;

/**
 * Parse + validate a provider's raw text response into the enhance payload.
 * `output`/`rationale` stay REQUIRED (the battle-scarred contract); the newer
 * fields are optional and parsed tolerantly — junk shapes are dropped, never
 * fatal, so an older or disobedient model can't fail a run over them.
 */
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
  const rec = data as Record<string, unknown>;
  const payload: EnhancePayload = {
    output: (rec.output as string).trim(),
    rationale: (rec.rationale as string).trim(),
  };

  if (Array.isArray(rec.assumptions)) {
    const assumptions = rec.assumptions
      .filter((a): a is string => typeof a === "string" && a.trim() !== "")
      .map((a) => a.trim())
      .slice(0, MAX_ASSUMPTIONS);
    if (assumptions.length > 0) payload.assumptions = assumptions;
  }
  if (typeof rec.targetNotes === "string" && rec.targetNotes.trim() !== "") {
    payload.targetNotes = rec.targetNotes.trim();
  }
  if (typeof rec.title === "string" && rec.title.trim() !== "") {
    payload.title = rec.title.trim().slice(0, MAX_TITLE_CHARS);
  }
  return payload;
}

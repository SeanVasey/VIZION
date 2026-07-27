import { TARGET_MODELS, type ModeId, type TargetModelId } from "@/lib/constants";
import { MODE_INSTRUCTIONS } from "@/lib/enhance/modes";
import { FORMAT_INSTRUCTIONS, type FormatId } from "@/lib/enhance/formats";
import { LENGTH_INSTRUCTIONS, type LengthId } from "@/lib/enhance/lengths";

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

/** True when the mode keeps the input's shape — for these the destination
 *  affects only routing/cost, never formatting (the UI says so honestly). */
export function isShapePreserving(mode: ModeId): boolean {
  return SHAPE_PRESERVING.has(mode);
}

/** Refinement passes the result view offers on a finished enhancement. */
export const REFINE_KINDS = ["shorter", "detail", "tone"] as const;
export type RefineKind = (typeof REFINE_KINDS)[number];

export interface EnhanceRefine {
  kind: RefineKind;
  /** The author's ORIGINAL input — required context for the `tone` pass. */
  baseInput?: string;
}

const REFINE_INSTRUCTIONS: Record<RefineKind, string> = {
  shorter:
    "REFINEMENT PASS: The input you receive is an already-enhanced prompt. Make it meaningfully shorter while keeping every load-bearing instruction and constraint. Do not add new content.",
  detail:
    "REFINEMENT PASS: The input you receive is an already-enhanced prompt. Add depth — concrete constraints, examples, and acceptance criteria it still lacks. Do not remove or weaken existing instructions.",
  tone: "REFINEMENT PASS: The input you receive is an already-enhanced prompt that drifted from the author's voice. Rewrite it so the voice, phrasing habits, and register match the AUTHOR'S ORIGINAL below, while keeping the improvements.",
};

/** The refine block appended after the mode instruction (empty when no
 *  refinement). Tone wraps the author's original in explicit delimiters. */
function refineBlock(refine?: EnhanceRefine): string[] {
  if (!refine) return [];
  const lines = [REFINE_INSTRUCTIONS[refine.kind]];
  if (refine.kind === "tone" && refine.baseInput) {
    lines.push("AUTHOR'S ORIGINAL:", "<original>", refine.baseInput, "</original>");
  }
  return ["", lines.join("\n")];
}

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

export interface SystemPromptOptions {
  mode: ModeId;
  target: TargetModelId;
  refine?: EnhanceRefine;
  /** Reformat only — the explicit output shape. */
  format?: FormatId;
  /** Condense/Expand only — how far to take it. */
  length?: LengthId;
}

/**
 * Per-mode knobs, gated HERE rather than at the wire.
 *
 * A knob that doesn't apply to the current mode is inert, not an error: the
 * builder simply doesn't read it. That keeps the route's validation to "is
 * this a legal value" and means a stale client — or a mode switched between
 * composing and sending — can never produce a self-contradictory prompt.
 */
function knobBlock({ mode, format, length }: SystemPromptOptions): string[] {
  if (length) {
    // LENGTH_INSTRUCTIONS is keyed by mode, so a length sent with a mode that
    // has no dial finds nothing and contributes nothing.
    const instruction = LENGTH_INSTRUCTIONS[mode]?.[length];
    if (instruction) return ["", instruction];
  }
  if (mode === "reformat" && format) {
    // The mode instruction offers the model a choice of shapes ("whichever
    // best fits the task"). Once the user has made that choice the offer has
    // to be withdrawn explicitly, or the two lines argue.
    return [
      "",
      `${FORMAT_INSTRUCTIONS[format]} This shape is chosen — it replaces the "whichever fits" latitude above; do not substitute a different structure.`,
    ];
  }
  return [];
}

/**
 * Build the system prompt that instructs the model to transform the user's
 * prompt for the given mode + target. Pure and deterministic so it can be
 * unit-tested and so the prompt prefix stays cache-friendly.
 *
 * Takes an options object rather than positionals: the knob count is growing
 * past the point where call sites can be read at a glance, and a boolean or
 * string in the wrong slot would be silently accepted by a positional
 * signature.
 */
export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const { mode, target, refine } = opts;
  const shapePreserving = SHAPE_PRESERVING.has(mode);
  const conventions = shapePreserving ? FORMAT_PRESERVATION : TARGET_CONVENTIONS[target];
  const outputContract = `${OUTPUT_CONTRACT_BASE} ${
    shapePreserving ? OUTPUT_STRUCTURE_FORBIDDEN : OUTPUT_STRUCTURE_ALLOWED
  }`;
  return [
    "You are VIZ(IO)N, a precise prompt engineer. You transform a user's prompt; you never answer or execute it.",
    "",
    MODE_INSTRUCTIONS[mode],
    ...knobBlock(opts),
    ...refineBlock(refine),
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
    '- "rationale" (required, string — a single plain string, never an array or object): a short, plain-language explanation of what you changed and why (2-4 sentences).',
    '- "assumptions" (optional, array of strings): assumptions you made to fill gaps in the request, one short line each. Omit the field entirely if you made none.',
    '- "targetNotes" (optional, string): one sentence naming any changes made specifically for the target engine. Omit if none.',
    '- "title" (optional, string): a short semantic name for this prompt (max 60 characters, no quotes), suitable as a library entry title.',
    "Do not wrap the JSON in markdown fences. Do not include any other text. Return this JSON envelope on every pass, including refinement passes.",
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
 * Best-effort extraction of the JSON envelope from raw model text. Models
 * occasionally wrap the object in a markdown fence despite the contract —
 * unwrap a whole-text fence; otherwise return the trimmed text as-is.
 */
function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/.exec(trimmed);
  return fence ? fence[1]!.trim() : trimmed;
}

/** Second-chance parse target for an envelope surrounded by prose: the
 *  outermost brace span. Null when no plausible object exists. */
function braceSpan(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start !== -1 && end > start ? raw.slice(start, end + 1) : null;
}

/** Field names models drift to when they rename the rationale. */
const RATIONALE_KEYS = ["rationale", "reasoning", "explanation", "notes"] as const;

/**
 * Salvage a rationale from a drifting envelope: the canonical field first,
 * then the known aliases; strings pass through, arrays of strings join. A
 * run is never failed over the rationale — a complete output with a missing
 * explanation beats a dead run (2026-07 production incident: Sonnet 5
 * returned a valid envelope whose rationale wasn't a string and the whole
 * run 502'd despite a perfect output).
 */
function coerceRationale(rec: Record<string, unknown>): string {
  for (const key of RATIONALE_KEYS) {
    const v = rec[key];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (Array.isArray(v)) {
      const parts = v
        .filter((p): p is string => typeof p === "string" && p.trim() !== "")
        .map((p) => p.trim());
      if (parts.length > 0) return parts.join("\n");
    }
  }
  return "";
}

/**
 * Parse + validate a provider's raw text response into the enhance payload.
 * Only `output` is load-bearing enough to fail a run over — everything else
 * is parsed tolerantly: fences/prose around the object are stripped, the
 * rationale is coerced from alias/array shapes (empty when unsalvageable),
 * and junk-shaped optional fields are dropped, never fatal.
 *
 * The two error messages are diagnostic discriminators (non-JSON vs missing
 * fields) — keep them distinct and stable.
 */
export function parseEnhancePayload(raw: string): EnhancePayload {
  let data: unknown;
  try {
    data = JSON.parse(extractJsonCandidate(raw));
  } catch {
    const span = braceSpan(raw);
    if (span === null) throw new Error("The model returned a non-JSON response.");
    try {
      data = JSON.parse(span);
    } catch {
      throw new Error("The model returned a non-JSON response.");
    }
  }
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as Record<string, unknown>).output !== "string"
  ) {
    throw new Error("The model response was missing the expected fields.");
  }
  const rec = data as Record<string, unknown>;
  const payload: EnhancePayload = {
    output: (rec.output as string).trim(),
    rationale: coerceRationale(rec),
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

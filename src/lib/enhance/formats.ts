/**
 * Output shapes for Reformat.
 *
 * Reformat and Adapt were separated by one sentence: "restructure into a
 * cleaner shape — whichever best fits the task" versus "re-render into the
 * target engine's idiom". That left the user unable to predict what either
 * would do, and left Reformat making a choice on their behalf that they were
 * perfectly able to make themselves.
 *
 * Naming the shape fixes the boundary in both directions: **Reformat is about
 * SHAPE, Adapt is about IDIOM.** Choosing a format is optional — omitting it
 * leaves today's "whichever fits" behaviour intact, so the rail adds control
 * without taking away the shortcut.
 */

export const FORMATS = ["json", "markdown", "steps", "fewshot", "xml"] as const;
export type FormatId = (typeof FORMATS)[number];

export const FORMAT_LABEL: Record<FormatId, string> = {
  json: "JSON",
  markdown: "Markdown",
  steps: "Steps",
  fewshot: "Few-shot",
  xml: "XML",
};

/**
 * One instruction per shape, appended to the Reformat mode instruction.
 *
 * Each says what the shape IS and what it must not cost, because the failure
 * mode of "put this in JSON" is a model that drops the prose nuance it can't
 * find a key for. The intent has to survive the reshaping — that is the whole
 * distinction between Reformat and rewriting.
 */
export const FORMAT_INSTRUCTIONS: Record<FormatId, string> = {
  json: "TARGET SHAPE — JSON: Express the prompt as a single JSON object inside the output string, with descriptive keys for the task, constraints, inputs, and expected output. Every instruction in the original must land in a field; if something has no natural key, keep it in a `notes` string rather than dropping it.",
  markdown:
    "TARGET SHAPE — MARKDOWN: Express the prompt as markdown with headings and bullet lists, grouping related instructions under shared headings. Use structure to make the instruction set scannable, not to pad it — do not invent sections the original gives you nothing to fill.",
  steps:
    "TARGET SHAPE — NUMBERED STEPS: Express the prompt as an ordered procedure the model performs in sequence. Each step is one action. Preserve any dependency the original implies, and keep constraints that apply throughout in a short preamble rather than repeating them per step.",
  fewshot:
    "TARGET SHAPE — FEW-SHOT: Express the prompt as a brief instruction followed by two or three worked input/output examples that demonstrate the pattern. Derive the examples from the original's own domain — invent illustrative content, never new requirements.",
  xml: "TARGET SHAPE — XML TAGS: Express the prompt with XML-style tags delimiting its parts (for example <task>, <context>, <constraints>, <output_format>). Tags mark boundaries so the engine can attend to each part separately; keep the prose inside them as the author wrote it.",
};

/** Runtime guard for the wire — the route validates against this rather than
 *  growing its own copy of the set. */
export function isFormatId(v: unknown): v is FormatId {
  return typeof v === "string" && (FORMATS as readonly string[]).includes(v);
}

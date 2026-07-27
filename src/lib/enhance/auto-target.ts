import type { ModeId, TargetModelId } from "@/lib/constants";

/**
 * Auto model routing — pick a target for the user when they'd rather not.
 *
 * A documented static table, deliberately NOT a model call: routing must be
 * free, instant, and explainable. A router that costs a request to decide
 * which request to make is a worse deal than picking a model yourself.
 *
 * "auto" is a UI and wire concept ONLY. `model_target` is a Postgres enum on
 * `usage_events.target`, `prompts.target_model` and `profiles.default_model`,
 * so a literal "auto" could never be written to any of them. The route
 * resolves it to a real id before anything else looks at the target, and the
 * resolved id is what's stored and what `resolvedTarget` reports back.
 *
 * The table, per the owner's call:
 *
 *   polish | clarify | condense   →  fast tier, unless the job is big
 *   expand | reformat | target    →  frontier tier, always
 *
 * The split is about how much *judgement* the mode needs, not how much text
 * it moves. Polish and Clarify are shape-preserving by contract — they may not
 * restructure — so the ceiling on a good answer is low and a fast model
 * reaches it. Condense is bounded the same way by its own instruction. Expand,
 * Reformat and Adapt all invent structure, which is where a frontier model
 * actually shows up in the output.
 *
 * Both tiers are Anthropic and both carry the full five-step thinking ladder,
 * so Auto can never land the user on a model whose thinking dial silently
 * disappears from the composer.
 */

/** Fast tier — enough for the shape-preserving modes on ordinary input. */
const FAST: TargetModelId = "sonnet_5";
/** Frontier tier — for modes that invent structure, and for big jobs. */
const FRONTIER: TargetModelId = "opus_5";

/**
 * Past this many characters a "simple" mode stops being simple: the risk is no
 * longer picking the right word, it's holding the whole thing in mind at once.
 * Media does the same thing for a different reason — an attachment means the
 * prompt is describing something the model has to reason about, not just tidy.
 */
export const LONG_INPUT_CHARS = 4_000;

/** Modes whose ceiling a fast model can reach on ordinary input. */
const FAST_WHEN_SMALL: Record<ModeId, boolean> = {
  polish: true,
  clarify: true,
  condense: true,
  expand: false,
  reformat: false,
  target: false,
};

/**
 * Resolve Auto to a real roster id. Total over `ModeId` by construction —
 * `FAST_WHEN_SMALL` is a `Record<ModeId, boolean>`, so a seventh mode is a
 * compile error here rather than a silent fall-through to some default.
 */
export function resolveAutoTarget(
  mode: ModeId,
  inputChars: number,
  hasMedia: boolean,
): TargetModelId {
  const big = inputChars > LONG_INPUT_CHARS || hasMedia;
  return FAST_WHEN_SMALL[mode] && !big ? FAST : FRONTIER;
}

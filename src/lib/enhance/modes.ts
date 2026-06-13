import type { ModeId } from "@/lib/constants";

/**
 * The five enhancement modes (product-spec §4.1). Each carries the instruction
 * VIZ(IO)N gives the model about *what* transformation to apply to the input
 * prompt. The per-target formatter (providers/formatters.ts) wraps this with the
 * idiomatic conventions of the chosen engine.
 */
export const MODE_INSTRUCTIONS: Record<ModeId, string> = {
  clarify:
    "CLARIFY: Resolve ambiguity and fix intent. Tighten scope and make implicit assumptions explicit, WITHOUT changing what the user is asking for. Do not add new requirements — only sharpen the existing ask.",
  expand:
    "EXPAND: Add the structure, constraints, examples, and missing specificity the prompt needs to succeed. Increase precision per line — more signal, not more padding. Surface edge cases and acceptance criteria the user implied but didn't state.",
  condense:
    "CONDENSE: Strip redundancy to the minimum viable prompt while preserving every load-bearing instruction. Be token-budget aware. Remove filler, restating, and hedging; keep intent and constraints intact.",
  reformat:
    "REFORMAT: Restructure the same intent into a cleaner shape — roles, sections, ordered steps, a JSON spec, a chain-of-thought scaffold, or a few-shot frame — whichever best fits the task. Change the structure, not the meaning.",
  target:
    "MODEL-TARGETED ADAPTATION: Re-render the prompt into the target engine's idiomatic syntax and conventions. Same composition, fitted to the instrument that will receive it. Preserve intent exactly while adopting the target's native structure.",
};

/** Human-facing one-line description used in the UI and rationale. */
export const MODE_BLURB: Record<ModeId, string> = {
  clarify: "Editing for sense before flourish.",
  expand: "More precision packed per line, not more padding.",
  condense: "The minimum viable prompt.",
  reformat: "Re-orchestration of the same motif.",
  target: "Same composition, different instrument.",
};

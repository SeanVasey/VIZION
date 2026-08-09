import type { ModeId } from "@/lib/constants";

/**
 * How far Condense and Expand should go.
 *
 * Both modes were one-speed: Condense trimmed to "the minimum viable prompt"
 * and Expand added "the structure and specificity the prompt needs", with no
 * way to say how much. That is fine when the model's instinct matches yours
 * and useless when it doesn't — and re-running to nudge it costs a second
 * billed request to express something the user already knew before the first.
 *
 * The dial is shared but the LABELS are per mode, because the same position
 * means opposite things: the aggressive end of Condense is the smallest
 * output, and the aggressive end of Expand is the largest. One set of words
 * ("Short / Medium / Long") would read as a lie on one of the two.
 */

export const LENGTHS = ["short", "medium", "long"] as const;
export type LengthId = (typeof LENGTHS)[number];

/** Whether the dial applies to a mode — derived from LENGTH_LABEL's keys so
 *  the capability set has exactly one source of truth (the shipped UI gates
 *  on `lengthOptions(mode) !== null`, which reads the same record). */
export function hasLengthControl(mode: ModeId): boolean {
  return lengthOptions(mode) !== null;
}

/**
 * Per-mode labels. Ordered least → most aggressive *for that mode*, so the
 * left-hand segment is always the gentlest change and the right-hand one is
 * always the biggest — the dial reads consistently even though its ends mean
 * opposite things.
 */
const LENGTH_LABEL: Partial<Record<ModeId, Record<LengthId, string>>> = {
  condense: { short: "Tight", medium: "Balanced", long: "Essential" },
  expand: { short: "Focused", medium: "Thorough", long: "Comprehensive" },
};

/** Labels for a mode, or null when the mode has no dial. */
export function lengthOptions(
  mode: ModeId,
): { id: LengthId; label: string }[] | null {
  const labels = LENGTH_LABEL[mode];
  if (!labels) return null;
  return LENGTHS.map((id) => ({ id, label: labels[id] }));
}

/**
 * One instruction per (mode, length). Written per mode rather than shared:
 * "be aggressive" means cut harder in one and elaborate harder in the other,
 * and a single sentence covering both would have to be vague enough to be
 * worthless.
 */
export const LENGTH_INSTRUCTIONS: Partial<
  Record<ModeId, Record<LengthId, string>>
> = {
  condense: {
    short:
      "LENGTH — TIGHT: Trim conservatively. Remove obvious redundancy, filler, and hedging, but keep the prompt's existing sentence structure and any instruction you are not certain is duplicated.",
    medium:
      "LENGTH — BALANCED: Compress meaningfully. Merge overlapping instructions and drop restatements, keeping every distinct constraint. Aim for roughly half the original length without losing a requirement.",
    long: "LENGTH — ESSENTIAL: Reduce to the smallest prompt that still carries every load-bearing instruction. Terse phrasing is expected; drop all courtesy, framing, and repetition. If a constraint is implied strongly enough by another, it may go — nothing else may.",
  },
  expand: {
    short:
      "LENGTH — FOCUSED: Add only what the prompt visibly lacks — the missing constraint, the unstated output format, the one ambiguous term. Keep the addition proportionate; do not restructure a short prompt into a document.",
    medium:
      "LENGTH — THOROUGH: Fill in the structure, constraints, and success criteria the request implies, with a concrete example where one clarifies an ambiguity. Every addition must be traceable to something the original asked for.",
    long: "LENGTH — COMPREHENSIVE: Develop the prompt fully — explicit scope, constraints, edge cases, output format, acceptance criteria, and worked examples. Depth must stay on-topic: elaborate what the request implies, never invent new requirements the author did not ask for.",
  },
};

/** Runtime guard for the wire. */
export function isLengthId(v: unknown): v is LengthId {
  return typeof v === "string" && (LENGTHS as readonly string[]).includes(v);
}

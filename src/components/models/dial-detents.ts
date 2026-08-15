import type { Detent } from "@/components/ui/HoldSlider";
import {
  AUTO_PREFERENCES,
  AUTO_PREFERENCE_LABEL,
  THINKING_LEVEL_LABEL,
  type ThinkingLevel,
} from "@/lib/constants";

/**
 * The two dials' ladders and their shared vocabulary.
 *
 * These used to live in EnhanceComposer, which was the only consumer while
 * both sliders hung off composer rails. The budget dial now lives inside the
 * Target sheet (owner direction, 2026-08-11 — "within the model selection
 * pane that slides out from the right"), so its ladder is needed in
 * TargetPicker and its tone ink in the dial trigger. One module, so the ramp
 * and the label ink can never disagree about what a level is.
 */

/** Hold-slider tone per thinking level — keyed to the level's IDENTITY, never
 *  its ladder position (the DepthGlyph rule), so "high" wears the same steel
 *  on Grok's 3-step ladder as on Fable's 5-step one. The ladder is a
 *  monochrome silver progression that brightens with depth — faint, silver,
 *  steel — and only the two tiers above High earn colour, the ultra violet
 *  the wash then floods (owner direction, 2026-08-15: no laser in the
 *  track). */
export const LEVEL_TONE: Record<ThinkingLevel, Detent["tone"]> = {
  minimal: "silver",
  low: "silver",
  medium: "steel",
  high: "steel",
  xhigh: "ultra",
  max: "ultra",
};

/**
 * A tone as TRIGGER INK. One ink below ultra: the sub-ultra ramp is a
 * monochrome silver progression (2026-08-15), so at rest the tier is carried
 * by the label's WORD and the meter glyph's filled bars, not by shades of
 * grey a user would have to compare — and only the ultra tier earns colour,
 * in the text-safe ultra ink (AA in both themes). Kept as a full tone map,
 * not a boolean, because it is the tone vocabulary's seam: a tone that ever
 * earns its own ink again changes one line here and nothing else.
 */
export const TONE_INK_CLASS: Record<Detent["tone"], string> = {
  faint: "text-silver",
  silver: "text-silver",
  steel: "text-silver",
  ultra: "text-ultra",
};

/** Auto rides the slider as the LEFTMOST detent — dragging fully left is the
 *  one-gesture route back to "send nothing, provider default applies". */
export const AUTO_DETENT: Detent = { id: "auto", label: "Auto", tone: "faint" };

export function buildThinkingDetents(ladder: readonly ThinkingLevel[]): Detent[] {
  return [
    AUTO_DETENT,
    ...ladder.map((level) => ({
      id: level,
      label: THINKING_LEVEL_LABEL[level],
      tone: LEVEL_TONE[level],
    })),
  ];
}

/** Auto-routing's budget dial, cheapest first so the fill grows with spend:
 *  budget → balanced → quality. That is AUTO_PREFERENCES *reversed* — the
 *  wire constant is quality-first and test-pinned, so the display order is
 *  derived here, never by reordering the constant. Quality tops the ramp at
 *  ultra: it is the stop that spends, and the peak caption below says so. */
export const BUDGET_DETENTS: Detent[] = [...AUTO_PREFERENCES].reverse().map((p) => ({
  id: p,
  label: AUTO_PREFERENCE_LABEL[p],
  tone: p === "budget" ? "silver" : p === "balanced" ? "steel" : "ultra",
}));

/**
 * The line shown under the capsule at each ladder's TOP stop — the reference
 * control's "consumes usage limits faster", in this app's own terms.
 *
 * It states the COST of the stop, which is the one thing the level's name
 * does not: "Max" and "Quality" both sound like unqualified goods. Only the
 * top stop earns one, so it reads as a consequence rather than a nag.
 */
export const THINKING_PEAK_CAPTION = "Deepest reasoning — slowest, highest cost";
export const BUDGET_PEAK_CAPTION = "Strongest models — spends your cap faster";

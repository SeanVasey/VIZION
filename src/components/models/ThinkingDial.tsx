"use client";

import { memo } from "react";
import { HoldSliderHint } from "@/components/ui/HoldSlider";
import { LEVEL_TONE, TONE_INK_CLASS } from "@/components/models/dial-detents";
import { useUIStore } from "@/stores/ui";
import { THINKING_LEVEL_LABEL, type ThinkingLevel } from "@/lib/constants";

/**
 * Reasoning-depth dial — the composer rail's always-visible effort control.
 *
 * WHAT THIS REPLACED, AND WHY. Until 2026-08-11 this was a trigger pill with
 * a disclosure chevron that opened a radio sheet, with the hold-slider
 * layered over it as an accelerator. Owner direction retired the sheet: "I
 * would prefer they not appear as dropdowns unless they actually utilize one
 * like the model selector... there should only be the dynamic slider". The
 * Target picker keeps its chevron because it genuinely opens a list of
 * sixteen models; depth is a five-step ladder, and a ladder is a slider.
 *
 * So the pill IS the slider now, in three senses at once:
 *
 *  - VISUALLY it is a button that states the current level in that level's
 *    own ink, with the meter glyph filled to match and, where the chevron
 *    used to be, a MINIATURE of the track it opens — filled to this level, in
 *    this level's colour. A control that expands, not one that drops down,
 *    and one that shows what it expands into (owner's second pass,
 *    2026-08-11; HoldSliderHint's header carries the full rationale).
 *  - BY POINTER, through the HoldSliderTrigger the composer wraps it in: a
 *    tap opens the capsule latched over this exact button, a hold or a
 *    sideways slide scrubs it directly.
 *  - BY ARIA, through `role="slider"` and the arrow-key ladder below. This
 *    is the part that let the sheet go. The sheet used to be the complete
 *    keyboard and screen-reader path and the single-pointer alternative WCAG
 *    2.5.7 requires; the slider role is a better answer to both, because it
 *    puts the whole ladder on the control itself instead of behind it —
 *    arrows step the value with no capsule involved, and a tap-then-tap on
 *    the latched track reaches any stop without a drag.
 *
 * NOT a native `<select>` or `<input type=range>`, for the reason the pair
 * has always had: globals.css floors `input, select, textarea` at 16px on
 * iOS (Safari zooms the page when a focused control computes under 16px and
 * rarely zooms back out). The floor is `!important` and out-specifies
 * `text-sm`, so a native control here would render 2px larger than the Target
 * pill directly above it — invisible in CI, unmissable on a phone. A button
 * leaves that rule's scope entirely, which is the same move TargetPicker
 * made. Both triggers still take ONE class string from the composer, so the
 * pills cannot drift apart.
 */
// Memoized: nested in the composer, which re-renders per keystroke and per
// SSE flush. Its `onChange` is a useCallback there, so all props are stable
// and the memo holds across stream flushes (PERF-006).
export const ThinkingDial = memo(ThinkingDialImpl);

function ThinkingDialImpl({
  value,
  options,
  onChange,
  label,
  triggerClassName,
  holdHint,
}: {
  /** The chosen level, or undefined for Auto (send nothing). */
  value: ThinkingLevel | undefined;
  /** The selected target's ladder, in ascending order. */
  options: readonly ThinkingLevel[];
  /** `null` clears back to Auto — the store's own "no level" signal. */
  onChange: (next: ThinkingLevel | null) => void;
  /** Accessible name for the dial, e.g. "Thinking depth". */
  label: string;
  triggerClassName?: string;
  /** True while a HoldSliderTrigger around this pill is live — renders the
   *  resting mini-track affordance. */
  holdHint?: boolean;
}) {
  // Read, not passed: this is the one-time coaching flag, it flips once per
  // device, and threading it through the composer would put a value that
  // never changes into the memo boundary this component exists behind.
  const dialTipSeen = useUIStore((s) => s.dialTipSeen);
  // The dial's ladder is [Auto, ...the target's own levels], so index 0 is
  // always "send nothing" and the capsule's detents line up 1:1 with these
  // values (buildThinkingDetents composes the same list).
  const max = options.length;
  const index = value ? options.indexOf(value) + 1 : 0;
  const tone = value ? LEVEL_TONE[value] : "faint";
  const text = value ? THINKING_LEVEL_LABEL[value] : "Auto";

  function commitIndex(next: number) {
    const clamped = Math.max(0, Math.min(max, next));
    if (clamped === index) return;
    onChange(clamped === 0 ? null : (options[clamped - 1] ?? null));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // The WAI-ARIA slider ladder, owned here at REST. While a capsule is
    // latched, use-hold-drag's window handler claims these keys first (it
    // runs at capture phase on window) and drives the open track instead —
    // one vocabulary, whichever surface is in front.
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "PageUp") {
      next = index + 1;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "PageDown") {
      next = index - 1;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = max;
    }
    if (next === null) return;
    e.preventDefault();
    commitIndex(next);
  }

  return (
    <button
      type="button"
      role="slider"
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={index}
      // The NAME of the value, not its ordinal — "Extra High" is what the
      // user chose; "4 of 5" is an implementation detail of this ladder.
      aria-valuetext={text}
      onKeyDown={onKeyDown}
      className={triggerClassName ?? PICKER_TRIGGER_FALLBACK_CLASS}
    >
      <DepthGlyph level={value ?? null} className="h-4 w-4 shrink-0" />
      {/* The level in the level's own ink — the colour-coding the ladder
          already uses inside the capsule, brought out to rest so the rail
          states the tier at a glance rather than only while open. `grow`
          mirrors the target trigger so a full-width variant pushes the grip
          to the edge; in the composer's content-width pill it is a no-op. */}
      <span className={`grow truncate text-left ${TONE_INK_CLASS[tone]}`}>{text}</span>
      {holdHint && (
        <HoldSliderHint value={index} max={max} tone={tone} pulse={!dialTipSeen} />
      )}
    </button>
  );
}

/** Prop-less fallback for renders outside a host that supplies the matched
 *  pair's class string (the unit suites). Mirrors picker-trigger's, minus the
 *  chevron's trailing room — this control has no chevron. */
const PICKER_TRIGGER_FALLBACK_CLASS =
  "font-body inline-flex min-h-[44px] items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm text-text";

/** Depth's category mark — a rising three-bar meter that is also a readout:
 *  bars fill to the chosen effort, and the two tiers above High (xhigh · max)
 *  trade Silver for the ultra-violet ink. `level` null/omitted renders the
 *  neutral mark (the dial under Auto). Keyed to the level id, not ladder
 *  position, so the same id renders identically for every model's ladder.
 *  Max's tall bar overshoots the meter's top line: effort past the marked
 *  scale. */
const BAR_PATHS = ["M6 19v-4", "M12 19v-8", "M18 19V7"] as const;
const MAX_TALL_PATH = "M18 19V4";
const STRONG_BARS: Record<ThinkingLevel, 0 | 1 | 2 | 3> = {
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 3,
  max: 3,
};
/** Faint enough to read as "empty slots", strong enough to keep the meter's
 *  silhouette — the filled count is decoration over the label, never the
 *  only signal. */
const FAINT = 0.28;

export function DepthGlyph({
  level = null,
  className,
}: {
  level?: ThinkingLevel | null;
  className?: string;
}) {
  const strong = level ? STRONG_BARS[level] : 3;
  const ultra = level === "xhigh" || level === "max";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={[className, ultra ? "text-ultra" : "text-silver"]
        .filter(Boolean)
        .join(" ")}
    >
      {BAR_PATHS.map((d, i) => (
        <path
          key={d}
          d={i === 2 && level === "max" ? MAX_TALL_PATH : d}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          opacity={i < strong ? 1 : FAINT}
        />
      ))}
    </svg>
  );
}

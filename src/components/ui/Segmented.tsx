"use client";

/**
 * Inline segmented control — a small, closed set of mutually exclusive
 * choices, all visible at once.
 *
 * A group of toggle buttons, NOT `role="radiogroup"`: radios promise an
 * arrow-key roving-tabindex contract these plain tab stops don't implement,
 * and `aria-pressed` describes what the control actually does under Tab+Enter
 * (WCAG AA). `ModeRig` is the repo's real radiogroup, roving focus and all —
 * reach for that shape only when the option count justifies it.
 *
 * Buttons rather than a `<select>` is the point: `<select>` is inside the iOS
 * focus-zoom rule's scope (`input, select, textarea`), so a small-text select
 * in a composer rail zooms the viewport on tap. See TargetPicker's header for
 * the same reasoning at a larger option count.
 *
 * The active segment fills with `bg-laser text-on-laser` — Void ink on a Laser
 * fill, never the reverse (guardrail §6). Deliberately NOT `btn-laser`: that
 * class marks the app's single primary action per surface, and
 * `composer-reset.test.tsx` counts it to enforce exactly one.
 *
 * Two widths, because two callers want opposite things. `fill` lays the
 * options out as EQUAL columns across the full container — one chassis with
 * `repeat(n, 1fr)` cells, the same instrument shape as `ModeRig`, sized by the
 * container instead of by the longest label. That is what the composer's Shape
 * and Depth rails need: five and three multi-word labels at 390px used to
 * overflow an intrinsically-sized pill, so "Few-shot" wrapped to two lines and
 * the chassis clipped mid-segment. Without `fill` the control keeps its
 * intrinsic inline width (Settings' theme picker, where three short labels sit
 * beside body copy).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  fill = false,
}: {
  options: readonly { id: T; label: string }[];
  /** `null` selects nothing — the "unset / inherit the default" state. */
  value: T | null;
  onChange: (next: T) => void;
  /** Accessible group name. */
  label: string;
  className?: string;
  /** Stretch to the container as equal columns (see the header). */
  fill?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={[
        "glass rounded-xl p-1",
        // Equal columns come from an inline gridTemplateColumns rather than a
        // `grid-cols-${n}` class: Tailwind only ships the classes it can see in
        // the source, so an interpolated one is absent from the bundle.
        fill ? "grid w-full" : "inline-flex",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        fill
          ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }
          : undefined
      }
    >
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={[
              // min-h-[44px] rather than the settings control's old py-2 (~36px):
              // every tappable thing in the composer meets the 44pt target.
              // whitespace-nowrap on both widths: a label that wraps mid-control
              // is the failure this component exists to avoid.
              "font-body min-h-[44px] whitespace-nowrap rounded-lg transition-colors",
              // Filled cells carry ModeRig's cell type (11px, tracked, cap-trim
              // so the glyphs centre rather than the font's ascent headroom) —
              // the size that lets six mode labels fit a 360px chassis, so five
              // shape labels fit comfortably.
              fill
                ? "cap-trim px-1.5 text-[0.6875rem] font-medium tracking-wide"
                : "px-3 text-sm",
              // selected-ink: the non-color cue that survives the light theme
              // (A11Y-003) — invisible on dark, a 5.5:1 boundary on light.
              active
                ? "selected-ink bg-laser text-on-laser"
                : "text-silver hover:text-chalk",
            ].join(" ")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

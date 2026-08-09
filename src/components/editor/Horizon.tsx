/**
 * Horizon — the quiet band between the header and the mode rig on Enhance.
 * One edge-faded hairline with a single node breathing at its centre: enough
 * to give the eye a point of rest between two dense chassis without becoming
 * a third one. It replaces the old prompt-optics emblem, which repeated the
 * brand mark ~200px below the same mark in the top bar.
 *
 * Height is a flat `h-7` (28px), and it is ALL padding: the mark inside is a
 * 1px rule and a 5px node at every size, so this number is the dead air above
 * and below the hairline and nothing else. With the page's `py-5` above and the
 * `-mb-3`-trimmed `gap-8` below, that puts 34px of clearance on each side of
 * the rule.
 *
 * It replaced the emblem at `min(width / 5, 64px)` — 52px of clearance per side
 * — to keep the swap free of spacing changes. That footprint was sized for an
 * SVG lockup, and once the lockup was a hairline it read as ~1.5x too much air
 * (2026-07 review). Shrink this to close that gap; never scale the rule or the
 * node, which are the part that was asked to stay.
 *
 * A flat height is correct now precisely because the aspect ratio no longer is:
 * it existed to track the emblem's `max-w-[320px]` viewBox so the band could not
 * grow the header on narrow screens, and there is nothing left inside that
 * scales with width. 28px is below the old curve at every viewport, so the
 * failure mode it guarded against cannot recur — but raise this number and the
 * guard is gone with it, so the e2e spec pins it at two widths.
 *
 * The rule is deliberately narrow (64%, capped at 240px) and fades to
 * transparent at both ends, so it can never be misread as a border belonging
 * to the bar above or the rig below — full-bleed here would just reinstate
 * the problem. Laser arrives through --accent-ink (Laser on dark, deep green
 * on light), never raw laser as a stroke on a light surface (§6).
 *
 * Purely decorative: aria-hidden, no role, no label, no text, nothing
 * focusable. The orientation sentence that used to live inside the emblem now
 * sits beside this component on the page, where screen readers still get it.
 *
 * `data-state` selects the motion rather than the keyframe being wired
 * straight to the class, so the node can later report request state (a light
 * travelling the rule during an in-flight enhance) without this file changing
 * shape. Today the only value is "idle".
 */
export function Horizon({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-state="idle"
      className={["horizon flex h-7 w-full items-center justify-center", className]
        .filter(Boolean)
        .join(" ")}
    >
      {/* The 5px node is a flex child of the 1px rule and overflows it 2px
          either side. That is what keeps the keyframes to a bare scale(): an
          absolutely-positioned node would need translate(-50%, -50%) repeated
          inside every frame just to stay put. */}
      <div className="horizon-rule flex h-px w-[64%] max-w-[240px] items-center justify-center">
        <span className="horizon-node h-[5px] w-[5px] rounded-full" />
      </div>
    </div>
  );
}

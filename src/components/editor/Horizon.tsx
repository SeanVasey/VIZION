/**
 * Horizon — the quiet band between the header and the mode rig on Enhance.
 * One edge-faded hairline with a single node breathing at its centre: enough
 * to give the eye a point of rest between two dense chassis without becoming
 * a third one. It replaces the old prompt-optics emblem, which repeated the
 * brand mark ~200px below the same mark in the top bar.
 *
 * Height is `min(width / 7.5, 44px)` — two thirds of the emblem's old
 * `min(width / 5, 64px)`, because the band inherited a footprint sized for an
 * SVG lockup and read as ~1.5x too much air above the composer for a hairline
 * and a dot (2026-07 review). Both terms scale together so the ratio holds at
 * every breakpoint; shrinking only the cap would leave small screens untouched.
 * The height stays derived from the band's own width rather than a flat `h-11`,
 * which looks equivalent and quietly grows the header on narrow screens.
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
      className={[
        "horizon flex aspect-[15/2] max-h-11 w-full items-center justify-center",
        className,
      ]
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

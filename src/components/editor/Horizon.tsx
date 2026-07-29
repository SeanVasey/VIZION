/**
 * Horizon — the quiet band between the header and the mode rig on Enhance.
 * One edge-faded hairline with a single node breathing at its centre: enough
 * to give the eye a point of rest between two dense chassis without becoming
 * a third one. It replaces the old prompt-optics emblem, which repeated the
 * brand mark ~200px below the same mark in the top bar.
 *
 * It is a drop-in for that emblem and deliberately keeps its footprint. The SVG
 * was `w-full max-w-[320px]` over a 320x64 viewBox, so its height was
 * `min(width, 320) / 5` — 64px from 352px up, but SHORTER below that (57.6px at
 * a 320px viewport). `aspect-[5/1] max-h-16` reproduces that curve exactly from
 * the band's own width, so the swap adds no height at any breakpoint. A flat
 * `h-16` looks equivalent and quietly grows the header on small screens.
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
        "horizon flex aspect-[5/1] max-h-16 w-full items-center justify-center",
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

/**
 * PromptFlow — the decorative "prompt optics" hero for the Enhance screen.
 * Replaces the plain guidance sentence (which is preserved for screen
 * readers): the (│›◯) aperture — the same bar · chevron · split-ring motif as
 * the brand mark, framed by its chrome parentheses — sits at the center of
 * two mirror-image wings of clean Laser lines, one emblem, symmetric about
 * the aperture. Deliberately quiet: the wings are slightly translucent
 * (`.flow-lines`) and carry a slow, staggered shimmer (`.flow-line`), and the
 * aperture halo keeps its ~6s breathe (`.flow-glow`) — all of it collapsed
 * to a static glow under the global reduced-motion rule. All strokes are
 * currentColor through the theme-aware roles (--accent-ink — never raw laser
 * as a stroke on a light surface, §6).
 */
export function PromptFlow({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <p className="sr-only">
        Paste a prompt and VIZ(IO)N rewrites it for your target model — the six
        modes below each transform it a different way.
      </p>
      <svg
        viewBox="0 0 320 64"
        aria-hidden="true"
        className="mx-auto block h-auto w-full max-w-[320px]"
      >
        {/* Aperture halo — a slow, gentle breathe. */}
        <circle cx="161" cy="32" r="16" fill="var(--laser-glow)" className="flow-glow" />

        {/* Chrome parentheses framing the aperture, as on the brand mark. */}
        <g
          className="text-silver"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        >
          <path d="M132 14a24 24 0 0 0 0 36" />
          <path d="M188 14a24 24 0 0 1 0 36" />
        </g>

        <g className="text-accent">
          {/* The (│›◯) aperture: bar · chevron · split ring. */}
          <g
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          >
            <rect x="140" y="20" width="3.5" height="24" rx="1.75" fill="currentColor" stroke="none" />
            <path d="m150.5 24 8.5 8-8.5 8" />
            <path d="M162.6 28.6a10 10 0 0 1 18.8 0" />
            <path d="M181.4 35.4a10 10 0 0 1-18.8 0" />
          </g>

          {/* Symmetric wings — the right-hand Laser lines and their exact
              mirror (about x=160, the parentheses' optical center) on the
              left, so the emblem reads balanced. */}
          <g
            className="flow-lines flow-out-glow"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          >
            <path className="flow-line" d="M204 24h108" />
            <path className="flow-line" d="M204 32h68" />
            <path className="flow-line" d="M204 40h88" />
            <g transform="translate(320 0) scale(-1 1)">
              <path className="flow-line" d="M204 24h108" />
              <path className="flow-line" d="M204 32h68" />
              <path className="flow-line" d="M204 40h88" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

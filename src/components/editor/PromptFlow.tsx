/**
 * PromptFlow — the decorative "prompt optics" hero for the Enhance screen.
 * Replaces the plain guidance sentence (which is preserved for screen readers):
 * a raw Silver signal enters the (│›◯) aperture — the same bar · chevron ·
 * split-ring motif as the brand mark, framed by its chrome parentheses — and
 * leaves as clean, ordered Laser lines.  Deliberately quiet: the lines are a
 * static illustration and the aperture halo's slow ~6s breathe (`.flow-glow`
 * in globals.css) is the ONLY motion, collapsed to a static glow under the
 * global reduced-motion rule.  All strokes are currentColor through the
 * theme-aware roles (--accent-ink — never raw laser as a stroke on a light
 * surface, §6).
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
        {/* Aperture halo — a slow, gentle breathe; the hero's only motion. */}
        <circle cx="161" cy="32" r="16" fill="var(--laser-glow)" className="flow-glow" />

        {/* Raw input — three uneven, drifting Silver signal lines — plus the
            chrome parentheses that frame the aperture on the brand mark. */}
        <g
          className="text-silver"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        >
          <path className="flow-dash" d="M8 24c10-4 21 4 32 0s21 4 32 0 21 4 32 0" />
          <path className="flow-dash" d="M8 32c11-4 23 4 34 0s23 4 34 0 23 4 34 0" />
          <path className="flow-dash" d="M8 40c10-3 20 3 30 0s20 3 30 0 20 3 30 0" />
          <path d="M132 14a24 24 0 0 0 0 36" strokeWidth="2" />
          <path d="M188 14a24 24 0 0 1 0 36" strokeWidth="2" />
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

          {/* Refined output — clean, ordered Laser lines (the reformat voice). */}
          <g
            className="flow-out-glow"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          >
            <path d="M204 24h108" />
            <path d="M204 32h68" />
            <path d="M204 40h88" />
          </g>
        </g>
      </svg>
    </div>
  );
}

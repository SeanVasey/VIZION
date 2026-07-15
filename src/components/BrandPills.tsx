import { APP_VERSION } from "@/lib/version";

/**
 * Brand + version micro-pills (remediation R1.4).  Uppercase Reddit Sans on a
 * surface fill with a hairline and a small Laser dot.  The version is read from
 * package.json at build time (NEXT_PUBLIC_APP_VERSION) — never hardcoded.
 */
export function BrandPills({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      <Pill>
        {/* bg-accent (--accent-ink), not bg-laser: raw Laser is invisible on
            the light pill surface (contrast law §6); dark is unchanged. */}
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-accent"
        />
        VASEY/AI
      </Pill>
      <Pill>v{APP_VERSION}</Pill>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-body inline-flex items-center gap-1.5 rounded-full border border-hair bg-surface px-2.5 py-1 text-[0.625rem] font-medium uppercase tracking-wider text-silver">
      {children}
    </span>
  );
}

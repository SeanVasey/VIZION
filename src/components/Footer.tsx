import Image from "next/image";
import { BRAND_MONOGRAMS_READY } from "@/lib/constants";
import { APP_VERSION } from "@/lib/version";

/**
 * Canonical footer (remediation R7).  Shown on login and Profile.  Carries the
 * VM (Vasey Multimedia) and V/AI monograms, the "VASEY/AI Presents" line, a
 * dynamic copyright year, and the version pill.  Respects the bottom safe-area.
 *
 * Monograms are Sean's real files; until they land in /public/brand the flag
 * keeps a typographic fallback (see BRAND_MONOGRAMS_READY).  When present they
 * render native on dark and invert(1) on light — never recoloured/redrawn.
 *
 * `inset` trims the vertical padding for the authed shell so it clears the
 * fixed bottom nav.
 */
export function Footer({ inset = false }: { inset?: boolean }) {
  const year = new Date().getFullYear();

  return (
    <footer
      className={`flex flex-col items-center gap-2 px-4 text-center ${
        inset ? "pb-4 pt-6" : "pb-safe pt-8"
      }`}
    >
      {BRAND_MONOGRAMS_READY ? (
        <div className="flex items-center gap-3">
          {/* Native on dark; .monogram applies invert(1) under light (R7.3). */}
          <Image
            src="/brand/vm-monogram.svg"
            alt="Vasey Multimedia"
            width={28}
            height={28}
            className="monogram h-7 w-auto"
          />
          <Image
            src="/brand/vai-monogram.svg"
            alt="VASEY/AI"
            width={28}
            height={28}
            className="monogram h-7 w-auto"
          />
        </div>
      ) : null}

      <p className="font-body text-xs font-medium uppercase tracking-wider text-text">
        VASEY/AI Presents
      </p>
      <p className="font-body text-[0.625rem] text-silver">
        Vasey Multimedia · © {year} · v{APP_VERSION}
      </p>
    </footer>
  );
}

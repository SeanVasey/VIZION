import Image from "next/image";
import { Wordmark } from "@/components/Wordmark";
import { BrandPills } from "@/components/BrandPills";
import { BRAND_MARK_SRC } from "@/lib/brand-assets";

/**
 * Login hero lockup (remediation R1.2 / R6.2): the transparent brand mark large
 * and centered ABOVE the VIZION wordmark, with the tagline and brand/version
 * pills.  Sits over the animated background.
 */
export function AuthHero() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {/* Decorative: the Wordmark below carries the accessible brand name.
          The aperture glyph is wide (1565×996) and fills its viewBox tightly,
          so size by width (keeping native aspect) and keep it modest so it
          stays in balance with the wordmark and the rest of the page. */}
      <Image
        src={BRAND_MARK_SRC}
        alt=""
        width={160}
        height={102}
        priority
        className="h-auto w-[160px]"
      />
      {/* The gate's h1 (A11Y-008): every screen gets one so the document
          outline never starts below level 1 — the ScreenHeader brand pattern. */}
      <h1 className="m-0 leading-none">
        <Wordmark className="text-3xl" />
      </h1>
      <p className="font-body max-w-[280px] text-pretty text-sm text-muted">
        Transform any prompt for the engine that&apos;s about to receive it.
      </p>
      <BrandPills />
    </div>
  );
}

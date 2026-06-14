import Image from "next/image";
import { Wordmark } from "@/components/Wordmark";
import { BrandPills } from "@/components/BrandPills";

/**
 * Login hero lockup (remediation R1.2 / R6.2): the transparent brand mark large
 * and centered ABOVE the VIZION wordmark, with the tagline and brand/version
 * pills.  Sits over the animated background.
 */
export function AuthHero() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {/* Decorative: the Wordmark below carries the accessible brand name.
          The aperture glyph is wide (1872×1084) and fills its viewBox tightly,
          so size by width (keeping native aspect) and keep it modest so it
          stays in balance with the wordmark and the rest of the page. */}
      <Image
        src="/brand/vizion-mark-token.svg"
        alt=""
        width={176}
        height={102}
        priority
        className="h-auto w-[176px]"
      />
      <Wordmark className="text-3xl" />
      <p className="font-body max-w-[280px] text-sm text-muted">
        Transform any prompt for the engine that&apos;s about to receive it.
      </p>
      <BrandPills />
    </div>
  );
}

import { Wordmark } from "@/components/Wordmark";
import { BrandPills } from "@/components/BrandPills";
import { BrandMark } from "@/components/BrandMark";

/**
 * Login hero lockup (remediation R1.2 / R6.2): the transparent brand mark large
 * and centered ABOVE the VIZION wordmark, with the tagline and brand/version
 * pills.  Sits over the animated background.
 */
export function AuthHero() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {/* Decorative (aria-hidden inside BrandMark): the Wordmark below carries
          the accessible brand name. The glyph fills its viewBox tightly, so
          size by width and let the 1024×892.8 aspect set the height. 144px,
          not the 160px the old wide mark took: this mark is nearly square
          (1.15:1 against the retired 1.57:1), so equal width would have stood
          ~40% taller and out-weighed the wordmark under it.
          `text-accent` — the theme-aware --accent-ink — keeps it AA-legible in
          both themes, per the DeveloperIcon colour rule. */}
      <BrandMark className="h-auto w-[144px] text-accent" />
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

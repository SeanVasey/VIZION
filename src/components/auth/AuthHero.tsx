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
      {/* Decorative: the Wordmark below carries the accessible brand name. */}
      <Image
        src="/brand/vizion-mark-token.svg"
        alt=""
        width={150}
        height={150}
        priority
        className="h-[150px] w-[150px]"
      />
      <Wordmark className="text-3xl" />
      <p className="font-body max-w-[280px] text-sm text-muted">
        Transform any prompt for the engine that&apos;s about to receive it.
      </p>
      <BrandPills />
    </div>
  );
}

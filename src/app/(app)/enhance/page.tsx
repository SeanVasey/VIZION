import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EnhanceComposer } from "@/components/editor/EnhanceComposer";
import { Horizon } from "@/components/editor/Horizon";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = { title: "Enhance" };

/**
 * Enhance screen — the composer (modes · editor · attachments · target ·
 * result). Media attachment lives INSIDE the composer's tray (2026-07 UX
 * audit) — the old below-the-fold media studio is gone.
 */
export default function EnhancePage() {
  return (
    <>
      <ScreenHeader brand />
      <div className="mx-auto flex max-w-screen-sm flex-col gap-8 px-4 py-5">
        {/* Orientation for screen readers — it used to live inside the hero
            emblem; Horizon is purely decorative and carries no text, so the
            sentence sits here instead. Per-mode detail lives in the ModeRig
            helper below the rig. */}
        <p className="sr-only">
          Paste a prompt and VIZ(IO)N rewrites it for your target model — the six modes
          below each transform it a different way.
        </p>
        <Horizon className="-mb-3" />
        <EnhanceComposer />
        <Footer inset />
      </div>
    </>
  );
}

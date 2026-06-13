import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EnhanceComposer } from "@/components/editor/EnhanceComposer";

export const metadata: Metadata = { title: "Enhance" };

/**
 * P1 shell of the Enhance screen — the composer chrome (mode chips, mono editor,
 * target "club rack", ENHANCE CTA).  The live provider-adapter wiring lands in P3.
 */
export default function EnhancePage() {
  return (
    <>
      <ScreenHeader brand />
      <div className="mx-auto max-w-screen-sm px-4 py-5">
        <EnhanceComposer />
      </div>
    </>
  );
}

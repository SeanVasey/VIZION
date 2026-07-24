import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EnhanceComposer } from "@/components/editor/EnhanceComposer";
import { PromptFlow } from "@/components/editor/PromptFlow";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = { title: "Enhance" };

// The media studio is below the fold and pulls in extraction/formatter code —
// split it into its own chunk so it never weighs down the initial Enhance load.
const MediaStudio = dynamic(() =>
  import("@/components/media/MediaStudio").then((m) => m.MediaStudio),
);

/**
 * Enhance screen — the composer (modes · editor · target · diff) plus the media
 * studio (attach a reference → fold it into a generation-ready prompt, §4.2).
 */
export default function EnhancePage() {
  return (
    <>
      <ScreenHeader brand />
      <div className="mx-auto flex max-w-screen-sm flex-col gap-8 px-4 py-5">
        {/* Hero — the animated prompt-optics graphic directly under the header
            (the old guidance sentence lives on inside it as sr-only text, so
            screen readers keep the orientation). Per-mode detail lives in the
            ModeRig help strip below the rig. */}
        <PromptFlow className="-mb-3" />
        <EnhanceComposer />
        {/* No hard divider — the media studio reads as part of the composer
            column (its header + hint carry the section break). */}
        <MediaStudio />
        <Footer inset />
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EnhanceComposer } from "@/components/editor/EnhanceComposer";
import { PromptFlow } from "@/components/editor/PromptFlow";
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
        {/* Hero — the animated prompt-optics graphic directly under the header
            (the old guidance sentence lives on inside it as sr-only text, so
            screen readers keep the orientation). Per-mode detail lives in the
            ModeRig helper below the rig. */}
        <PromptFlow className="-mb-3" />
        <EnhanceComposer />
        <Footer inset />
      </div>
    </>
  );
}

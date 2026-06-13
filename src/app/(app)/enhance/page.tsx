import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EnhanceComposer } from "@/components/editor/EnhanceComposer";
import { MediaStudio } from "@/components/media/MediaStudio";

export const metadata: Metadata = { title: "Enhance" };

/**
 * Enhance screen — the composer (modes · editor · target · diff) plus the media
 * studio (attach a reference → fold it into a generation-ready prompt, §4.2).
 */
export default function EnhancePage() {
  return (
    <>
      <ScreenHeader brand />
      <div className="mx-auto flex max-w-screen-sm flex-col gap-8 px-4 py-5">
        <EnhanceComposer />
        <div className="h-px bg-hair" />
        <MediaStudio />
      </div>
    </>
  );
}

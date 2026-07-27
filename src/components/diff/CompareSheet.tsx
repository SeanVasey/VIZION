"use client";

import { Sheet } from "@/components/ui/Sheet";
import type { DiffSegment } from "@/lib/enhance/diff";
import { InputSegments, OutputSegments } from "@/components/diff/segments";

/**
 * Full side-by-side (stacked on mobile) diff read — the deep-compare surface
 * the inline result view links to, so the primary card can stay clean.
 */
export function CompareSheet({
  open,
  onClose,
  diff,
  refined = false,
  hunkOf,
  rejected,
}: {
  open: boolean;
  onClose: () => void;
  diff: DiffSegment[];
  /** True when the diff's input side is a previous RESULT (refine run). */
  refined?: boolean;
  hunkOf?: (number | null)[];
  rejected?: ReadonlySet<number>;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Compare">
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-hair bg-[color-mix(in_srgb,var(--void)_60%,transparent)] p-4">
          <p className="font-body mb-2 text-xs uppercase tracking-wider text-silver">
            {refined ? "Previous result" : "Original"}
          </p>
          {/* OUTPUT REGION: prompt bodies render in mono. */}
          <p className="mono whitespace-pre-wrap break-words text-sm text-silver">
            <InputSegments segments={diff} />
          </p>
        </div>
        <div className="glass rounded-2xl p-4">
          <p className="font-body mb-2 text-xs uppercase tracking-wider text-silver">
            Enhanced
          </p>
          <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
            <OutputSegments segments={diff} hunkOf={hunkOf} rejected={rejected} />
          </p>
        </div>
      </div>
    </Sheet>
  );
}

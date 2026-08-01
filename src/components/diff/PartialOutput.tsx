"use client";

import { useCopy } from "@/components/ui/use-copy";
import { CheckMark } from "@/components/ui/glyphs";

/**
 * Card for output that streamed in before a run failed — a run that dies at
 * 90% must not erase copyable work. Rendered beneath the error line (the
 * hook retains `stream.partialOutput` on error). Copy and Use-as-draft make
 * the surviving text actionable instead of a dead end.
 */
export function PartialOutput({
  text,
  onUse,
}: {
  text: string;
  onUse?: (text: string) => void;
}) {
  const { copied, copy } = useCopy();

  return (
    <div className="glass rounded-2xl p-4">
      <p className="font-body mb-2 text-xs uppercase tracking-wider text-silver">
        Partial output
      </p>
      {/* OUTPUT REGION: streamed result text renders in mono (JetBrains). */}
      <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">{text}</p>
      <div className={`mt-3 grid gap-2 ${onUse ? "grid-cols-2" : "grid-cols-1"}`}>
        <button
          type="button"
          onClick={() => void copy(text)}
          className="btn-secondary flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl px-2 text-sm"
        >
          {copied ? (
            <span className="inline-flex items-center gap-1">
              Copied
              <CheckMark />
            </span>
          ) : (
            "Copy"
          )}
        </button>
        {onUse && (
          <button
            type="button"
            onClick={() => onUse(text)}
            className="btn-secondary flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl px-2 text-sm"
          >
            Use as draft
          </button>
        )}
      </div>
    </div>
  );
}

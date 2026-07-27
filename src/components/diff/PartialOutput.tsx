"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";

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
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Surfacing beats silence: tell the user copy did NOT happen.
      toast({
        tone: "error",
        text: "Couldn't copy — your browser blocked clipboard access. Select the text and copy manually.",
      });
    }
  }

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
          onClick={copy}
          className="btn-secondary flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl px-2 text-sm"
        >
          {copied ? "Copied ✓" : "Copy"}
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

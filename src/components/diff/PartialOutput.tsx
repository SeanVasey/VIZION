"use client";

/**
 * Static card for output that streamed in before a run failed — a run that
 * dies at 90% must not erase copyable work. Rendered by the composer beneath
 * the error line (the hook retains `stream.partialOutput` on error).
 */
export function PartialOutput({ text }: { text: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="font-body mb-2 text-xs uppercase tracking-wider text-silver">
        Partial output
      </p>
      {/* OUTPUT REGION: streamed result text renders in mono (JetBrains). */}
      <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">{text}</p>
    </div>
  );
}

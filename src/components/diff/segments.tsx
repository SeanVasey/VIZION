import type { DiffSegment } from "@/lib/enhance/diff";

/**
 * Shared diff-segment renderers — used by the result view's Enhanced card,
 * the collapsed original, and the Compare sheet, so the two surfaces can't
 * drift. Both bodies are OUTPUT REGIONS (mono at the call site).
 */

/** Input-side render: equal + removed (struck/dimmed) reconstructs the input
 *  losslessly — nothing the author typed is hidden. */
export function InputSegments({ segments }: { segments: DiffSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.op === "added" ? null : (
          <span
            key={i}
            className={seg.op === "removed" ? "line-through opacity-60" : undefined}
          >
            {seg.text}
          </span>
        ),
      )}
    </>
  );
}

/**
 * Output-side render honoring per-hunk accept/reject decisions: added text of
 * a rejected hunk is hidden, removed text of a rejected hunk rejoins the
 * output as plain text. With no decisions this is exactly the classic
 * equal + added reconstruction.
 */
export function OutputSegments({
  segments,
  hunkOf,
  rejected,
}: {
  segments: DiffSegment[];
  /** Per-segment hunk id (assignHunks) — required only when rejecting. */
  hunkOf?: (number | null)[];
  rejected?: ReadonlySet<number>;
}) {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.op === "equal") return <span key={i}>{seg.text}</span>;
        const id = hunkOf?.[i];
        const isRejected =
          id !== null && id !== undefined && (rejected?.has(id) ?? false);
        if (seg.op === "added") {
          return isRejected ? null : (
            <span key={i} className="text-accent">
              {seg.text}
            </span>
          );
        }
        // removed: only visible when its hunk was rejected (it's output again).
        return isRejected ? <span key={i}>{seg.text}</span> : null;
      })}
    </>
  );
}

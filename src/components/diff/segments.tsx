import type { DiffSegment } from "@/lib/enhance/diff";

/**
 * Shared diff-segment renderers — used by the result view's Enhanced card,
 * the collapsed original, and the Compare sheet, so the two surfaces can't
 * drift. Both bodies are OUTPUT REGIONS (mono at the call site).
 */

/**
 * How removed text reads wherever it is shown as proof of a change: struck
 * through in Flare.
 *
 * NO `opacity-*`. `--flare` darkens on light themes so the raw token clears AA
 * in both (4.79:1 dark / 5.64:1 light on glass) — but it clears it by 0.29,
 * and the `opacity-70` this used to carry spent that headroom many times over:
 * 2.98:1 dark, 3.59:1 light. There is no alpha that keeps this AA on dark, so
 * the dim is gone rather than reduced; `line-through` was always what said
 * "removed", the fade only said it more quietly.
 */
export const REMOVED_CLASS = "text-flare line-through";
/** Added tokens carry an underline as the non-color channel (A11Y-006):
 *  dark-theme accent vs chalk is a 1.09:1 luminance pair — hue is the ONLY
 *  difference, invisible through a grayscale filter — while the removed side
 *  always had its strike. Decoration mirrors the strike's weight. */
export const ADDED_CLASS = "text-accent underline decoration-1 underline-offset-2";

/** Input-side render: equal + removed (struck) reconstructs the input
 *  losslessly — nothing the author typed is hidden. */
export function InputSegments({ segments }: { segments: DiffSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.op === "added" ? null : (
          <span key={i} className={seg.op === "removed" ? REMOVED_CLASS : undefined}>
            {seg.text}
          </span>
        ),
      )}
    </>
  );
}

/**
 * Two-sided render for a straight before→after comparison (version compare,
 * and any surface that wants the proof rather than the result): removals in
 * struck Flare, additions in Accent, equal text plain.
 *
 * This is the treatment the library's version compare grew inline; it lives
 * here so the enhance and library surfaces can't drift apart.
 */
export function ComparisonSegments({ segments }: { segments: DiffSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.op === "removed" ? (
          <span key={i} className={REMOVED_CLASS}>
            {seg.text}
          </span>
        ) : (
          <span key={i} className={seg.op === "added" ? ADDED_CLASS : undefined}>
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
            <span key={i} className={ADDED_CLASS}>
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

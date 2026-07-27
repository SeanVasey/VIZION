/**
 * Loading placeholder — a shape where content will land, instead of the word
 * "Loading…". Sized by the caller so the placeholder matches what replaces it
 * and the layout doesn't jump.
 *
 * The pulse is ambient: it answers to `prefers-reduced-motion` (the global
 * collapse) AND to the Reduced-effects switch, leaving a static block that
 * still communicates "something is coming".
 */
export function Skeleton({
  className = "",
  lines = 1,
}: {
  className?: string;
  /** Render a stack of bars, the last one short, like a paragraph. */
  lines?: number;
}) {
  if (lines > 1) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className={`skeleton h-3 rounded ${i === lines - 1 ? "w-2/3" : "w-full"} ${className}`}
          />
        ))}
      </div>
    );
  }
  return <div aria-hidden="true" className={`skeleton rounded ${className}`} />;
}

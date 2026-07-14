"use client";

/**
 * Live progress for a streaming model run: a Laser sweep on a Hair track,
 * the current processing step (aria-live so screen readers hear step changes,
 * which are rare — never per-token), and a usage quick view (tokens in/out +
 * running cost) once numbers are known.
 *
 * `indeterminate` is the media-upload mode: staged step labels drive the bar
 * with no token stream, so the usage row is hidden until an explicit usage
 * arrives.
 */
export function StreamProgress({
  step,
  tokenIn = 0,
  tokenOut = 0,
  costUsd,
  indeterminate = false,
  className = "",
}: {
  step: string;
  tokenIn?: number;
  tokenOut?: number;
  /** Running cost in USD; omit until an authoritative figure exists. */
  costUsd?: number;
  indeterminate?: boolean;
  className?: string;
}) {
  const showUsage = !indeterminate && (tokenIn > 0 || tokenOut > 0);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`} role="status" aria-live="polite">
      <div className="stream-progress-track">
        <span className="stream-progress-sweep" aria-hidden="true" />
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-body text-xs text-silver">{step}</span>
        {showUsage && (
          <span className="font-body shrink-0 text-xs tabular-nums text-silver">
            ⌁ {tokenIn}→{tokenOut} tok
            {typeof costUsd === "number" && costUsd > 0 && ` · $${costUsd.toFixed(4)}`}
          </span>
        )}
      </div>
    </div>
  );
}

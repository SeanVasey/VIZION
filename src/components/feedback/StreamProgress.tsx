"use client";

/**
 * Live progress for a streaming model run: a Laser sweep on a Hair track and
 * the current processing step (aria-live so screen readers hear step changes,
 * which are rare — never per-token).
 *
 * The token/cost usage ticker used to live here too; the 2026-08-07 streaming
 * console moved it into StreamingResult's header (the one surface that shows
 * live numbers), so this component is just the sweep + step line for both
 * consumers (StreamingResult, and AttachmentTray's staged media steps).
 */
export function StreamProgress({
  step,
  className = "",
}: {
  step: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="stream-progress-track">
        <span className="stream-progress-sweep" aria-hidden="true" />
      </div>
      {/* The live region covers ONLY the step label (rare changes). */}
      <span className="font-body text-xs text-silver" role="status" aria-live="polite">
        {step}
      </span>
    </div>
  );
}

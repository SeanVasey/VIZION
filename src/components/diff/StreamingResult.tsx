"use client";

import { useEffect, useRef } from "react";
import { StreamProgress } from "@/components/feedback/StreamProgress";

/**
 * The in-flight result surface — a live console card in the same Chalk-end
 * footprint the finished diff will occupy: identical wrapper
 * (`glass result-shimmer rounded-2xl p-4`), identical caption register and
 * header geometry, and an identical mono body, so the swap to
 * TransformationDiff never reflows the text. Everything streaming-only —
 * beacon, sweep track, tail fade, caret, top-edge light — is ornament that
 * simply vanishes on handoff.
 */
export function StreamingResult({
  step,
  partialOutput,
  tokenIn,
  tokenOut,
  costUsd,
}: {
  step: string;
  partialOutput: string;
  tokenIn: number;
  tokenOut: number;
  costUsd: number;
}) {
  const sectionRef = useRef<HTMLElement>(null);

  // UX-03: the card mounts below the fold on a phone and nothing brought it
  // into view. Mount IS run start (the composer mounts this surface exactly
  // then and keeps it through the active→pending gap), so scroll once here;
  // scroll-mt on the section clears the sticky glass-chrome header
  // (ScreenHeader: ~68px content + safe-area). The growing tail is
  // deliberately NOT followed afterwards — the reader owns their scroll
  // position.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sectionRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  // Newly-arrived text fades in: everything before the previous rAF flush is
  // "settled" plain text; the newest slice renders in a keyed .stream-tail
  // span whose remount restarts the fade. Math.min (never a render-time ref
  // write) resets cleanly when a new run empties the string; the effect
  // records the settled length AFTER paint, so the batch that just arrived is
  // the one that animates.
  const settledRef = useRef(0);
  const settledLen = Math.min(settledRef.current, partialOutput.length);
  useEffect(() => {
    settledRef.current = partialOutput.length;
  }, [partialOutput]);
  const settled = partialOutput.slice(0, settledLen);
  const tail = partialOutput.slice(settledLen);

  const showUsage = tokenIn > 0 || tokenOut > 0;

  return (
    <section
      ref={sectionRef}
      aria-label="Enhancement in progress"
      className="flex scroll-mt-[calc(env(safe-area-inset-top)+80px)] flex-col gap-4"
    >
      <div className="glass result-shimmer stream-live rounded-2xl p-4">
        {/* Caption row — the finished card's exact header geometry (mb-2,
            justify-between, micro-caps register), so STREAMING becomes
            "Enhanced" in place on handoff. */}
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="font-body inline-flex items-center gap-2 text-xs uppercase tracking-wider text-silver">
            <span className="stream-beacon shrink-0" aria-hidden="true" />
            Streaming
          </p>
          {/* Usage ticker: numbers announced, glyphs decorative (the
              EnhanceComposer ⌁ pattern — PRI-013). Outside the aria-live
              region, so per-token updates never flood a screen reader. */}
          {showUsage && (
            <p className="font-body shrink-0 text-xs tabular-nums text-silver">
              <span aria-hidden="true">⌁ </span>
              {tokenIn}
              <span aria-hidden="true">→</span>
              {tokenOut} tok
              {costUsd > 0 && ` · $${costUsd.toFixed(4)}`}
            </p>
          )}
        </div>
        {/* Slim sweep track + the aria-live step line — the unchanged shared
            component; no tokens passed, so its own usage row stays dormant. */}
        <StreamProgress step={step} className="mb-3" />
        {partialOutput ? (
          /* OUTPUT REGION: streamed result text renders in mono (JetBrains).
             The tail span is an INLINE box (opacity-only fade — transforms
             don't apply to inline boxes, and inline-block would break
             pre-wrap line wrapping), so whitespace integrity holds across the
             settled/tail boundary. */
          <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
            {settled}
            <span key={settledLen} className="stream-tail">
              {tail}
            </span>
            <span className="stream-caret" aria-hidden="true" />
          </p>
        ) : (
          /* Waiting for the first token — pending is stated by the step live
             region above; these lines are pure decoration. */
          <div className="flex flex-col gap-2" aria-hidden="true">
            <span className="skeleton h-4 w-11/12 rounded-md" />
            <span className="skeleton h-4 w-4/5 rounded-md" />
          </div>
        )}
      </div>
    </section>
  );
}

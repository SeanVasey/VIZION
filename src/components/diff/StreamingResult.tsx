"use client";

import { StreamProgress } from "@/components/feedback/StreamProgress";

/**
 * The in-flight result surface: partial output streams into the same
 * Chalk-end card the finished diff will occupy (mono body, Laser shimmer),
 * topped by the live progress bar. When the run completes, EnhanceComposer
 * swaps this for TransformationDiff — same footprint, no layout jump.
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
  return (
    <section className="flex flex-col gap-4" aria-label="Enhancement in progress">
      <StreamProgress
        step={step}
        tokenIn={tokenIn}
        tokenOut={tokenOut}
        costUsd={costUsd > 0 ? costUsd : undefined}
      />
      <div className="glass result-shimmer rounded-2xl p-4">
        <p className="font-body mb-2 text-xs uppercase tracking-wider text-silver">
          Enhanced
        </p>
        {/* OUTPUT REGION: streamed result text renders in mono (JetBrains). */}
        <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
          {partialOutput}
          <span className="text-accent" aria-hidden="true">
            ▍
          </span>
        </p>
      </div>
    </section>
  );
}

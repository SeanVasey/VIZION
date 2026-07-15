"use client";

/**
 * Branded route-level error surface — render/server errors previously fell
 * through to Next's generic "Application error" screen with none of the
 * locked tokens and no way back.
 */
export default function RouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-screen-sm flex-col px-4 py-5 pt-safe">
      <div className="glass rounded-2xl p-6 text-center">
        <p className="font-display text-balance text-xl tracking-wide text-text">
          Something went wrong
        </p>
        <p className="font-body mt-2 text-sm text-muted">
          The screen hit an unexpected error. Your prompts are safe on the
          server — try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="btn-laser pill mx-auto mt-5 inline-flex min-h-[44px] items-center justify-center px-5 text-sm"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

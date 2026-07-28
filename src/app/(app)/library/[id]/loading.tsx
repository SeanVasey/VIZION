import { ScreenHeader } from "@/components/ScreenHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading boundary for a saved prompt — see the Library one for
 * why these exist. This page makes up to three sequential Supabase round trips
 * (prompt · version metadata · the compare pair's bodies), so it is the
 * longest blocking navigation in the app and the one that most needs its
 * header and back chevron on screen immediately.
 */
export default function PromptLoading() {
  return (
    <>
      <ScreenHeader title="Prompt" backHref="/library" />
      <div
        className="mx-auto flex max-w-screen-sm flex-col gap-5 px-4 py-5"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Loading this prompt…</span>
        <div className="glass rounded-2xl p-5">
          <Skeleton className="h-4 w-3/5 rounded" />
          <Skeleton className="mt-3 h-3 w-1/3 rounded" />
        </div>
        <div className="glass rounded-2xl p-5">
          <Skeleton lines={4} />
        </div>
      </div>
    </>
  );
}

import { ScreenHeader } from "@/components/ScreenHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading boundary for Enhance.
 *
 * The page itself does no data fetching, but it is still a dynamic route (the
 * app layout reads cookies) and the composer is the heaviest client bundle in
 * the app — so between tapping the tab and seeing anything there is a real RSC
 * round trip plus a chunk fetch. This is also what automatic `<Link>` prefetch
 * warms: a dynamic route is prefetched only as far as its nearest loading
 * boundary, so without this file there is nothing to prefetch and the tab
 * cannot respond instantly however good the press feedback is.
 */
export default function EnhanceLoading() {
  return (
    <>
      <ScreenHeader brand />
      <div
        className="mx-auto flex max-w-screen-sm flex-col gap-8 px-4 py-5"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Loading the composer…</span>
        {/* Hero graphic. */}
        <Skeleton className="mx-auto h-24 w-40 rounded-2xl" />
        {/* Mode rig. */}
        <div className="flex gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-9 flex-1 rounded-full" />
          ))}
        </div>
        {/* Editor + target + CTA. */}
        <div className="glass rounded-2xl p-4">
          <Skeleton lines={3} />
        </div>
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="mx-auto h-11 w-40 rounded-full" />
      </div>
    </>
  );
}

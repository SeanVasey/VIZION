import { ScreenHeader } from "@/components/ScreenHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { MODES } from "@/lib/constants";

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
        {/* Horizon band — same h-7 footprint and -mb-3 trim as the real one,
            sketched as its centre rule so nothing jumps when it paints. */}
        <div className="-mb-3 flex h-7 items-center justify-center">
          <Skeleton className="h-px w-[64%] max-w-[240px] rounded-full" />
        </div>
        {/* Mode rig — six equal cells in one chassis, plus the helper line. */}
        <div className="flex flex-col gap-2">
          {/* Geometry matches the real ModeRig (DSN-008): gap-0 and the live
              mode count, so the placeholder doesn't jump on hydration. */}
          <div
            style={{ gridTemplateColumns: `repeat(${MODES.length}, minmax(0, 1fr))` }}
            className="glass grid gap-0 rounded-2xl p-1"
          >
            {MODES.map((m) => (
              <Skeleton key={m.id} className="min-h-[56px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="mx-auto h-3 w-3/5 rounded" />
        </div>
        {/* Editor + rails + CTA. */}
        <div className="glass rounded-2xl p-4">
          <Skeleton lines={3} />
        </div>
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="mx-auto h-11 w-40 rounded-full" />
      </div>
    </>
  );
}

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
        {/* The composer chassis — ONE solid rounded-rectangle holding rails,
            editor, tray rows and the CTA, exactly as EnhanceComposer ships it
            (its comment: "every control lives within the one rounded-
            rectangle"). The skeleton had drifted to the pre-chassis layout of
            three separate blocks (audit VAR-09). */}
        <div className="glass-solid flex flex-col rounded-2xl">
          {/* Target + Thinking rails. */}
          <div className="flex min-h-[56px] items-center justify-between px-4 py-3">
            <Skeleton className="h-3 w-16 rounded" />
            <Skeleton className="h-9 w-32 rounded-full" />
          </div>
          <div className="flex min-h-[56px] items-center justify-between border-t border-hair px-4 py-3">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-9 w-28 rounded-full" />
          </div>
          {/* Editor area. */}
          <div className="border-t border-hair px-4 py-4">
            <Skeleton lines={3} />
            <div className="h-16" />
          </div>
          {/* Template chip row. */}
          <div className="border-t border-hair px-4 py-3">
            <Skeleton className="h-9 w-36 rounded-full" />
          </div>
          {/* Attach row. */}
          <div className="flex items-center gap-3 border-t border-hair px-4 py-3">
            <Skeleton className="h-11 w-36 rounded-full" />
            <Skeleton className="ml-auto h-9 w-32 rounded-full" />
          </div>
          {/* Bottom rail: token estimate · Clear · ENHANCE. */}
          <div className="flex min-h-[60px] items-center border-t border-hair px-4 py-2">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="ml-auto mr-4 h-3 w-12 rounded" />
            <Skeleton className="h-11 w-36 rounded-full" />
          </div>
        </div>
      </div>
    </>
  );
}

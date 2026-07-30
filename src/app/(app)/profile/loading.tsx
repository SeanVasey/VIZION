import { ScreenHeader } from "@/components/ScreenHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading boundary for Settings — see the Library one for why
 * these exist. Settings blocks on `auth.getUser()` plus a profile row, which
 * is two round trips before anything at all can paint.
 */
export default function SettingsLoading() {
  return (
    <>
      <ScreenHeader title="Settings" />
      <div
        className="mx-auto flex max-w-screen-sm flex-col gap-6 px-4 py-5"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Loading your settings…</span>
        {/* Avatar + identity block. */}
        <div className="flex items-center gap-4">
          <Skeleton className="h-24 w-24 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-2/5 rounded" />
            <Skeleton className="mt-3 h-3 w-3/5 rounded" />
          </div>
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="glass rounded-2xl p-5">
            <Skeleton className="h-3 w-1/4 rounded" />
            <Skeleton className="mt-4 h-11 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </>
  );
}

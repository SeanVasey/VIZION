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
        {/* Identity hero — the real screen CENTERS the avatar with the name
            and handle stacked beneath it; the old side-by-side sketch made
            the whole hero jump on data (audit VAR-09). */}
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="h-24 w-24 rounded-full" />
          <Skeleton className="h-5 w-40 rounded" />
          <Skeleton className="h-3 w-24 rounded" />
        </div>
        {/* Sections: a label above each card, first card with two labeled
            fields (Identity), the rest as row cards. */}
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20 rounded" />
          <div className="glass rounded-2xl p-5">
            <Skeleton className="h-3 w-1/4 rounded" />
            <Skeleton className="mt-2 h-11 w-full rounded-lg" />
            <Skeleton className="mt-4 h-3 w-1/3 rounded" />
            <Skeleton className="mt-2 h-11 w-full rounded-lg" />
          </div>
        </div>
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-24 rounded" />
            <div className="glass rounded-2xl p-5">
              <Skeleton className="h-4 w-2/5 rounded" />
              <Skeleton className="mt-4 h-4 w-3/5 rounded" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

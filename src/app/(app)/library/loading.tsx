import { ScreenHeader } from "@/components/ScreenHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading boundary for the Library.
 *
 * Without one, tapping the Library tab does *nothing visible* until every
 * Supabase query on the page has resolved — the page render is what blocks, so
 * the old screen simply sits there and the tab reads as broken. With it, the
 * header and the shape of the list paint on the same frame as the tab press,
 * and the rows fill in when the data lands.
 *
 * The skeleton mirrors the real layout (header · search + filter row · card
 * stack) so nothing jumps when the content replaces it.
 */
export default function LibraryLoading() {
  return (
    <>
      <ScreenHeader title="Library" />
      <div
        className="mx-auto flex max-w-screen-sm flex-col gap-5 px-4 py-5"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Loading your library…</span>
        {/* Search field + Filter button. */}
        <div className="flex gap-2">
          <Skeleton className="h-11 flex-1 rounded-xl" />
          <Skeleton className="h-11 w-24 rounded-xl" />
        </div>
        <ul className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="glass rounded-2xl p-4">
              <Skeleton className="h-4 w-3/5 rounded" />
              <Skeleton className="mt-3 h-3 w-2/5 rounded" />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

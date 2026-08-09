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
 * The skeleton mirrors the real above-the-fold layout (header · search +
 * filter row · quick-chip row · card stack). It cannot know which VIEW the
 * URL asks for (loading.tsx gets no searchParams), so it draws the default
 * prompts view; the drafts view swaps in on data.
 */
export default function LibraryLoading() {
  return (
    <>
      <ScreenHeader title="Library" />
      <div
        className="mx-auto flex max-w-screen-sm flex-col gap-6 px-4 py-5"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Loading your library…</span>
        <div className="flex flex-col gap-4">
          {/* Search field + Filter button. */}
          <div className="flex gap-2">
            <Skeleton className="h-11 flex-1 rounded-xl" />
            <Skeleton className="h-11 w-24 rounded-xl" />
          </div>
          {/* The two quick chips (Recent · Favorites) the real page always
              renders between search and cards — their ~32px row was missing,
              so every card sat high and jumped down on data (audit VAR-09). */}
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-28 rounded-full" />
          </div>
          <ul className="flex flex-col gap-3">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="glass rounded-2xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <Skeleton className="h-4 w-3/5 rounded" />
                  <Skeleton className="h-4 w-20 rounded" />
                </div>
                <Skeleton className="mt-3 h-3 w-4/5 rounded" />
                <Skeleton className="mt-2 h-3 w-2/5 rounded" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

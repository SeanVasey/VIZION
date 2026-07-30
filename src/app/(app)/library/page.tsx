import type { Metadata } from "next";
import Link from "next/link";
import { ScreenHeader } from "@/components/ScreenHeader";
import { createClient } from "@/lib/supabase/server";
import { LibraryBrowser } from "@/components/library/LibraryBrowser";
import { ActivityFeed } from "@/components/library/ActivityFeed";
import { DraftsList } from "@/components/library/DraftsList";
import { Footer } from "@/components/Footer";
import { queryDraftsPage } from "@/lib/drafts/queries";
import {
  isDraftsView,
  libraryHref,
  parseLibraryParams,
  type LibraryFilter,
} from "@/lib/library/paging";
import {
  queryLibraryFacets,
  queryLibraryPage,
  type LibraryFacets,
  type PromptCard,
} from "@/lib/library/queries";

export const metadata: Metadata = { title: "Library" };

/**
 * The Drafts view's own header row. The filter sheet lives inside
 * `LibraryBrowser`, which this branch does not render — without a way back the
 * user would be stranded in Drafts with only the browser Back button.
 */
function DraftsViewChrome({ filter }: { filter: LibraryFilter }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-display m-0 text-lg tracking-wide text-text">Drafts</h2>
      <Link
        href={libraryHref({ ...filter, view: "all" })}
        className="tap-44 font-body inline-flex items-center text-sm text-accent transition-colors hover:text-chalk"
      >
        All prompts
      </Link>
    </div>
  );
}

/**
 * Library — saved prompts with server-side search/filter/sort via URL params
 * and keyset cursor pagination (2026-07 UX audit), plus the activity feed.
 * Server state via Supabase, scoped by RLS.
 */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filter = parseLibraryParams(await searchParams);
  const supabase = await createClient();

  // Drafts are a different relation, so this branches BEFORE queryLibraryPage —
  // calling it for view=drafts would quietly return prompts. The prompt-only
  // narrowing params (model/mode/tag/collection/q) do not apply here and are
  // ignored rather than silently reinterpreted.
  if (isDraftsView(filter)) {
    const { cards: draftCards, nextCursor: draftCursor, unavailable } =
      await queryDraftsPage(supabase);
    return (
      <>
        <ScreenHeader title="Library" />
        <div className="mx-auto flex max-w-screen-sm flex-col gap-6 px-4 py-5">
          <DraftsViewChrome filter={filter} />
          <DraftsList
            initialCards={draftCards}
            nextCursor={draftCursor}
            unavailable={unavailable}
          />
          <Footer inset />
        </div>
      </>
    );
  }

  let cards: PromptCard[];
  let nextCursor: string | null;
  let facets: LibraryFacets;
  try {
    [{ cards, nextCursor }, facets] = await Promise.all([
      queryLibraryPage(supabase, filter),
      queryLibraryFacets(supabase),
    ]);
  } catch {
    // A failed query must not masquerade as "Nothing saved yet" — the user's
    // library still exists on the server.
    return (
      <>
        <ScreenHeader title="Library" />
        <div className="mx-auto flex max-w-screen-sm flex-col px-4 py-5">
          <div className="glass rounded-2xl p-6 text-center" role="alert">
            <p className="font-display text-balance text-xl tracking-wide text-text">
              Couldn&apos;t load your library
            </p>
            <p className="font-body mt-2 text-sm text-muted">
              Your prompts are safe on the server — check your connection and reload.
            </p>
          </div>
        </div>
      </>
    );
  }

  const { data: activity } = await supabase
    .from("activity_events")
    .select("id, type, meta, created_at, prompt_id")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <>
      <ScreenHeader title="Library" />
      <div className="mx-auto flex max-w-screen-sm flex-col gap-6 px-4 py-5">
        {/* Keyed by the filter URL so client-accumulated pages reset when the
            filter changes (a stale page 2 from another filter must not leak). */}
        <LibraryBrowser
          key={libraryHref(filter)}
          initialCards={cards}
          nextCursor={nextCursor}
          filter={filter}
          facets={facets}
        />
        <ActivityFeed events={activity ?? []} />
        <Footer inset />
      </div>
    </>
  );
}

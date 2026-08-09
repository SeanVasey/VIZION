import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
import { createClient } from "@/lib/supabase/server";
import { LibraryBrowser } from "@/components/library/LibraryBrowser";
import { ActivityFeed } from "@/components/library/ActivityFeed";
import { DraftsList } from "@/components/library/DraftsList";
import { DraftsToolbar } from "@/components/library/DraftsToolbar";
import { Footer } from "@/components/Footer";
import { queryDraftModelFacets, queryDraftsPage } from "@/lib/drafts/queries";
import {
  isDraftsView,
  libraryHref,
  parseLibraryParams,
} from "@/lib/library/paging";
import {
  queryLibraryFacets,
  queryLibraryPage,
  type LibraryFacets,
  type PromptCard,
} from "@/lib/library/queries";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filter = parseLibraryParams(await searchParams);
  const supabase = await createClient();

  // Drafts are a different relation, so this branches BEFORE queryLibraryPage —
  // calling it for view=drafts would quietly return prompts. `q`, `model` and
  // `mode` all map onto real draft columns and narrow this view too; `tag` and
  // `collection` are prompts-only and have nothing to match, so they are ignored
  // rather than reinterpreted into something the user did not ask for.
  if (isDraftsView(filter)) {
    const [{ cards: draftCards, nextCursor: draftCursor, unavailable }, modelFacets] =
      await Promise.all([
        queryDraftsPage(supabase, filter),
        queryDraftModelFacets(supabase),
      ]);
    return (
      <>
        <ScreenHeader title="Library" />
        <div className="mx-auto flex max-w-screen-sm flex-col gap-6 px-4 py-5">
          <DraftsToolbar filter={filter} modelFacets={modelFacets} />
          <DraftsList
            initialCards={draftCards}
            nextCursor={draftCursor}
            unavailable={unavailable}
            filter={filter}
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
          <Footer inset />
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

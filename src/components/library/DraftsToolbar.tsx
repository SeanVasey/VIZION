"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MODEL_LABELS } from "@/lib/library/model-labels";
import { libraryHref, type LibraryFilter } from "@/lib/library/paging";

/**
 * The Drafts view's own search + model filter.
 *
 * The prompts library's controls live inside `LibraryBrowser`, which the drafts
 * branch does not render — so without this the view had no way to search, and no
 * way back to All prompts except the browser's Back button.
 *
 * Search is submitted rather than debounced-as-you-type: it is a server round
 * trip that changes the URL, and a keystroke-per-navigation would push a history
 * entry per character. Same reason `LibraryBrowser` commits on submit.
 *
 * The model chips offer only models the user's drafts actually contain, with
 * counts — the same rule the prompts filter sheet follows, and the reason this
 * takes facets rather than the global sixteen-model roster.
 */
export function DraftsToolbar({
  filter,
  modelFacets,
}: {
  filter: LibraryFilter;
  /** `null` = the drafts table is unavailable, so offer no filters at all. */
  modelFacets: { id: string; count: number }[] | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(filter.q ?? "");
  // Re-seed when the URL changes underneath (back button, chip navigation).
  useEffect(() => setDraft(filter.q ?? ""), [filter.q]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    router.push(libraryHref({ ...filter, ...(q ? { q } : { q: undefined }) }));
  }

  const chip = (active: boolean) =>
    [
      "tap-44 font-body inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
      active
        ? "selected-ink bg-laser text-on-laser"
        : "glass text-silver hover:text-chalk",
    ].join(" ");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display m-0 text-lg tracking-wide text-text">Drafts</h2>
        <button
          type="button"
          onClick={() => router.push(libraryHref({ ...filter, view: "all" }))}
          className="tap-44 font-body inline-flex items-center text-sm text-accent transition-colors hover:text-chalk"
        >
          All prompts
        </button>
      </div>

      <form onSubmit={submit} role="search" className="flex items-center gap-2">
        <label htmlFor="drafts-search" className="sr-only">
          Search drafts
        </label>
        <input
          id="drafts-search"
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search drafts"
          autoCapitalize="none"
          autoCorrect="off"
          className="glass font-body min-w-0 w-full rounded-xl bg-transparent px-4 py-3 text-base text-text placeholder:text-muted focus:outline-none"
        />
        <button
          type="submit"
          className="btn-secondary flex min-h-[44px] shrink-0 items-center justify-center px-4 text-sm"
        >
          Search
        </button>
      </form>

      {modelFacets && modelFacets.length > 1 && (
        <div className="flex flex-wrap gap-2" aria-label="Filter drafts by model">
          <button
            type="button"
            aria-pressed={!filter.model}
            onClick={() => router.push(libraryHref({ ...filter, model: undefined }))}
            className={chip(!filter.model)}
          >
            All models
          </button>
          {modelFacets.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={filter.model === m.id}
              onClick={() =>
                router.push(
                  libraryHref({
                    ...filter,
                    model: m.id as NonNullable<LibraryFilter["model"]>,
                  }),
                )
              }
              className={chip(filter.model === m.id)}
            >
              {MODEL_LABELS.get(m.id) ?? m.id}
              {/* Dim only on the Laser fill — see countClass in
                  LibraryFilterSheet for why the glass chip carries none. */}
              <span className={filter.model === m.id ? "opacity-80" : undefined}>
                {m.count}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

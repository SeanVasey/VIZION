"use client";

import { memo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MODE_LABEL, TARGET_MODELS, type ModeId } from "@/lib/constants";
import { relativeTime } from "@/lib/library/util";
import {
  countActiveFilters,
  libraryHref,
  type LibraryFilter,
} from "@/lib/library/paging";
import type { LibraryFacets, PromptCard } from "@/lib/library/queries";
import { fetchLibraryPageAction } from "@/lib/library/actions";
import { LibraryFilterSheet } from "@/components/library/LibraryFilterSheet";

export type { PromptCard } from "@/lib/library/queries";

const MODEL_LABEL_MAP = new Map<string, string>(
  TARGET_MODELS.map((m) => [m.id, m.label]),
);

/**
 * Saved-prompt browser (2026-07 UX audit): saved work leads; filters are
 * summoned. One search field + one Filter button (badge = active filters)
 * opening the sheet; exactly two quick chips (Favorites, Recent) outside it.
 * Filtering/sorting/pagination are server-side via URL params — this
 * component only accumulates "Load more" pages.
 */
export function LibraryBrowser({
  initialCards,
  nextCursor,
  filter,
  facets,
}: {
  initialCards: PromptCard[];
  nextCursor: string | null;
  filter: LibraryFilter;
  facets: LibraryFacets;
}) {
  const router = useRouter();
  const [searchDraft, setSearchDraft] = useState(filter.q ?? "");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [extraCards, setExtraCards] = useState<PromptCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(nextCursor);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, startLoadMore] = useTransition();

  const cards = [...initialCards, ...extraCards];
  const activeFilters = countActiveFilters(filter);
  const isDefaultView = activeFilters === 0 && !filter.q;

  function submitSearch() {
    const q = searchDraft.trim();
    router.push(libraryHref({ ...filter, ...(q ? { q } : { q: undefined }) }));
  }

  function loadMore() {
    if (!cursor) return;
    setLoadError(null);
    const raw = {
      q: filter.q,
      model: filter.model,
      mode: filter.mode,
      tag: filter.tag,
      view: filter.view,
      sort: filter.sort,
    };
    const current = cursor;
    startLoadMore(async () => {
      const res = await fetchLibraryPageAction(raw, current);
      if (res.ok && res.cards) {
        setExtraCards((prev) => [...prev, ...res.cards!]);
        setCursor(res.nextCursor ?? null);
      } else {
        setLoadError(res.error ?? "Couldn't load more.");
      }
    });
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Saved prompts">
      {/* Search + the one Filter button. */}
      <div className="flex gap-2">
        <label htmlFor="library-search" className="sr-only">
          Search prompt titles
        </label>
        <input
          id="library-search"
          type="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          enterKeyHint="search"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              submitSearch();
              e.currentTarget.blur();
            }
          }}
          placeholder="Search titles…"
          className="glass font-body min-w-0 flex-1 rounded-xl bg-transparent px-4 py-3 text-base text-text placeholder:text-muted focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label={`Filters${activeFilters ? ` (${activeFilters} active)` : ""}`}
          className="glass relative flex min-h-[44px] w-12 shrink-0 items-center justify-center rounded-xl text-silver transition-colors hover-hair hover:text-chalk"
        >
          {/* Funnel icon (1.5px stroke, style-guide §1.4). */}
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
            <path
              d="M4 6h16M7 12h10M10 18h4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          {activeFilters > 0 && (
            <span
              aria-hidden="true"
              className="font-body absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-laser px-1 text-[0.625rem] font-semibold text-on-laser"
            >
              {activeFilters}
            </span>
          )}
        </button>
      </div>

      {/* Exactly two quick chips outside the sheet. */}
      <div className="flex flex-wrap gap-2">
        <QuickChip
          active={isDefaultView}
          onClick={() => router.push("/library")}
          label="Recent"
        />
        <QuickChip
          active={filter.view === "favorites"}
          onClick={() =>
            router.push(
              libraryHref({
                ...filter,
                view: filter.view === "favorites" ? "all" : "favorites",
              }),
            )
          }
          label="★ Favorites"
        />
      </div>

      {/* Cards. */}
      {cards.length === 0 ? (
        isDefaultView ? (
          <div className="glass rounded-2xl p-6 text-center">
            <p className="font-display text-balance text-xl tracking-wide text-text">
              Nothing saved yet
            </p>
            <p className="mt-2 text-sm text-muted">
              Enhance a prompt and tap{" "}
              <span className="text-text">Save to library</span> — it lands here with
              full version history.
            </p>
          </div>
        ) : (
          <p className="font-body py-6 text-center text-sm text-silver" role="status">
            No prompts match. Search looks at titles — use the tag filter for tags.
          </p>
        )
      ) : (
        <ul className="flex flex-col gap-3">
          {cards.map((p) => (
            <PromptRow key={p.id} prompt={p} />
          ))}
        </ul>
      )}

      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="glass font-body min-h-[44px] rounded-xl px-4 text-sm text-text hover-hair transition-colors disabled:opacity-60"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
      {loadError && (
        <p className="font-body text-center text-sm text-flare" role="alert">
          {loadError}
        </p>
      )}

      <LibraryFilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filter={filter}
        facets={facets}
      />
    </section>
  );
}

/** Memoized card row: recognition-first — title, mode, model, an output
 *  preview, and human time (2026-07 UX audit). */
const PromptRow = memo(function PromptRow({ prompt: p }: { prompt: PromptCard }) {
  return (
    <li>
      <Link
        href={`/library/${p.id}`}
        className="glass hover-hair block rounded-2xl p-4 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="font-body min-w-0 text-base text-text">
            {p.favorite && (
              <span aria-label="Favorite" className="mr-1 text-accent">
                ★
              </span>
            )}
            {p.title}
          </p>
          <span className="font-body shrink-0 text-xs text-accent">
            {MODEL_LABEL_MAP.get(p.target_model) ?? p.target_model}
          </span>
        </div>
        {p.preview && (
          <p className="font-body mt-1 line-clamp-2 text-xs leading-snug text-silver">
            {p.preview}
          </p>
        )}
        <p className="font-body mt-1 text-xs tabular-nums text-silver">
          {p.mode ? `${MODE_LABEL[p.mode as ModeId] ?? p.mode} · ` : ""}
          {relativeTime(p.updated_at)} · {p.versions} version
          {p.versions === 1 ? "" : "s"}
          {p.archived ? " · archived" : ""}
          {p.tags.length > 0 ? ` · ${p.tags.map((t) => `#${t}`).join(" ")}` : ""}
        </p>
      </Link>
    </li>
  );
});

function QuickChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "tap-44 font-body inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
        active ? "bg-laser text-on-laser" : "glass text-silver hover:text-chalk",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

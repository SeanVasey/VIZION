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
import {
  fetchLibraryPageAction,
  updatePromptTitleAction,
  setFavoriteAction,
  setArchivedAction,
  softDeletePromptAction,
  undoDeletePromptAction,
  deletePromptAction,
} from "@/lib/library/actions";
import { LibraryFilterSheet } from "@/components/library/LibraryFilterSheet";
import { CollectionSheet } from "@/components/library/CollectionSheet";
import { Sheet } from "@/components/ui/Sheet";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { useToast } from "@/components/ui/Toast";
import { useSwipeActions } from "@/components/library/use-swipe-actions";

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
  const { toast } = useToast();
  const [searchDraft, setSearchDraft] = useState(filter.q ?? "");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [extraCards, setExtraCards] = useState<PromptCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(nextCursor);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, startLoadMore] = useTransition();
  const [menuFor, setMenuFor] = useState<PromptCard | null>(null);

  const cards = [...initialCards, ...extraCards];
  const activeFilters = countActiveFilters(filter);
  const isDefaultView = activeFilters === 0 && !filter.q;
  const collectionNames = new Map(facets.collections.map((c) => [c.id, c.name]));

  function submitSearch() {
    const q = searchDraft.trim();
    router.push(libraryHref({ ...filter, ...(q ? { q } : { q: undefined }) }));
  }

  /** Swipe-left delete: the same soft delete + Undo the ⋯ menu performs. */
  function swipeDelete(p: PromptCard) {
    void softDeletePromptAction(p.id).then((res) => {
      if (!res.ok) {
        setLoadError(res.error ?? "Couldn't delete.");
        return;
      }
      router.refresh();
      toast({
        text: "Prompt deleted",
        action: {
          label: "Undo",
          onAction: () => {
            void undoDeletePromptAction(p.id).then(() => router.refresh());
          },
        },
      });
    });
  }

  /** Swipe-right favorite toggle. */
  function swipeFavorite(p: PromptCard) {
    void setFavoriteAction(p.id, !p.favorite).then((res) => {
      if (!res.ok) setLoadError(res.error ?? "Couldn't update favorites.");
      else router.refresh();
    });
  }

  function loadMore() {
    if (!cursor) return;
    setLoadError(null);
    const raw = {
      q: filter.q,
      model: filter.model,
      mode: filter.mode,
      tag: filter.tag,
      collection: filter.collection,
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
            <PromptRow
              key={p.id}
              prompt={p}
              collectionName={
                p.collection_id ? collectionNames.get(p.collection_id) : undefined
              }
              onMenu={setMenuFor}
              onFavorite={swipeFavorite}
              onDelete={swipeDelete}
            />
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
          {loadingMore ? "Loading more…" : "Load more"}
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
      {menuFor && (
        <CardActionsSheet
          prompt={menuFor}
          collections={facets.collections}
          onClose={() => setMenuFor(null)}
        />
      )}
    </section>
  );
}

/** Per-card actions (2026-07 UX audit): rename, favorite, archive, move to
 *  collection, and soft delete with Undo — summoned from the card's ⋯. */
function CardActionsSheet({
  prompt,
  collections,
  onClose,
}: {
  prompt: PromptCard;
  collections: LibraryFacets["collections"];
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState(prompt.title);
  const [error, setError] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [pending, startAction] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, close = true) {
    setError(null);
    startAction(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "That didn't stick — try again.");
        return;
      }
      router.refresh();
      if (close) onClose();
    });
  }

  function softDelete() {
    const id = prompt.id;
    setError(null);
    startAction(async () => {
      const res = await softDeletePromptAction(id);
      if (!res.ok) {
        setError(res.error ?? "Couldn't delete.");
        return;
      }
      router.refresh();
      onClose();
      toast({
        text: "Prompt deleted",
        action: {
          label: "Undo",
          onAction: () => {
            void undoDeletePromptAction(id).then(() => router.refresh());
          },
        },
      });
    });
  }

  const itemClass =
    "glass font-body flex min-h-[44px] w-full items-center justify-between rounded-xl px-4 text-sm text-text hover-hair transition-colors disabled:opacity-60";

  return (
    <Sheet open onClose={onClose} title={prompt.title}>
      <div className="flex flex-col gap-4">
        {/* Rename. */}
        <div className="flex gap-2">
          <label htmlFor="rename-prompt" className="sr-only">
            Prompt name
          </label>
          <input
            id="rename-prompt"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            className="glass font-body min-w-0 flex-1 rounded-xl bg-transparent px-4 py-2.5 text-base text-text focus:outline-none"
          />
          <button
            type="button"
            disabled={pending || title.trim() === "" || title.trim() === prompt.title}
            onClick={() => run(() => updatePromptTitleAction(prompt.id, title))}
            className="btn-laser min-h-[44px] shrink-0 rounded-xl px-4 text-sm disabled:opacity-50"
          >
            Rename
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => setFavoriteAction(prompt.id, !prompt.favorite))
            }
            className={itemClass}
          >
            {prompt.favorite ? "Remove from favorites" : "Add to favorites"}
            <span aria-hidden="true" className="text-accent">
              ★
            </span>
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setArchivedAction(prompt.id, !prompt.archived))}
            className={itemClass}
          >
            {prompt.archived ? "Unarchive" : "Archive"}
            <span aria-hidden="true">▤</span>
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setMoveOpen(true)}
            className={itemClass}
          >
            Move to collection…
            <span aria-hidden="true">⌂</span>
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={softDelete}
            className="btn-destructive font-body flex min-h-[44px] w-full items-center justify-between rounded-xl px-4 text-sm disabled:opacity-60"
          >
            Delete
            <span aria-hidden="true">✕</span>
          </button>
          {prompt.archived && (
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmPurge(true)}
              className="btn-destructive font-body flex min-h-[44px] w-full items-center justify-between rounded-xl px-4 text-sm disabled:opacity-60"
            >
              Delete permanently
              <span aria-hidden="true">⌦</span>
            </button>
          )}
        </div>

        {error && (
          <p className="font-body text-sm text-flare" role="alert">
            {error}
          </p>
        )}
      </div>

      <ConfirmSheet
        open={confirmPurge}
        onClose={() => setConfirmPurge(false)}
        title="Delete permanently?"
        body={`"${prompt.title}" and all ${prompt.versions} of its versions will be gone for good — this cannot be undone.`}
        confirmLabel="Delete permanently"
        destructive
        onConfirm={() => run(() => deletePromptAction(prompt.id))}
      />
      <CollectionSheet
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        prompt={prompt}
        collections={collections}
        onMoved={() => {
          setMoveOpen(false);
          onClose();
        }}
      />
    </Sheet>
  );
}

/** Memoized card row: recognition-first — title, mode, model, an output
 *  preview, and human time (2026-07 UX audit). The ⋯ menu is a SIBLING of
 *  the link, absolutely positioned, so no interactive element nests. */
const PromptRow = memo(function PromptRow({
  prompt: p,
  collectionName,
  onMenu,
  onFavorite,
  onDelete,
}: {
  prompt: PromptCard;
  collectionName?: string;
  onMenu: (p: PromptCard) => void;
  onFavorite: (p: PromptCard) => void;
  onDelete: (p: PromptCard) => void;
}) {
  const swipe = useSwipeActions();
  return (
    <li className="relative overflow-hidden rounded-2xl">
      {/* Actions sit UNDER the card and are revealed by sliding it. They are
          real buttons, but the ⋯ menu remains the discoverable, keyboard- and
          screen-reader-reachable path — swipe is an accelerator. */}
      <div aria-hidden={swipe.open === null} className="absolute inset-y-0 left-0 flex">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            onFavorite(p);
            swipe.close();
          }}
          className="flex w-[84px] items-center justify-center rounded-l-2xl bg-laser text-lg text-on-laser"
        >
          <span aria-hidden="true">★</span>
          <span className="sr-only">
            {p.favorite ? `Remove ${p.title} from favorites` : `Favorite ${p.title}`}
          </span>
        </button>
      </div>
      <div aria-hidden={swipe.open === null} className="absolute inset-y-0 right-0 flex">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            onDelete(p);
            swipe.close();
          }}
          className="flex w-[84px] items-center justify-center rounded-r-2xl bg-flare text-lg text-on-laser"
        >
          <span aria-hidden="true">✕</span>
          <span className="sr-only">Delete {p.title}</span>
        </button>
      </div>
      <div
        {...swipe.handlers}
        onClickCapture={swipe.onClickCapture}
        style={swipe.style}
        className="relative transition-transform duration-150 ease-out motion-reduce:transition-none"
      >
      <Link
        href={`/library/${p.id}`}
        className="glass hover-hair block rounded-2xl p-4 pr-12 transition-colors"
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
          {collectionName ? ` · ⌂ ${collectionName}` : ""}
          {p.tags.length > 0 ? ` · ${p.tags.map((t) => `#${t}`).join(" ")}` : ""}
        </p>
      </Link>
      <button
        type="button"
        onClick={() => onMenu(p)}
        aria-label={`Actions for ${p.title}`}
        className="absolute bottom-1 right-1 flex h-11 w-11 items-center justify-center rounded-xl text-silver transition-colors hover:text-chalk"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          ⋯
        </span>
      </button>
      </div>
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

"use client";

import { memo, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LEGACY_TARGET_IDS,
  MODE_LABEL,
  TARGET_DEVELOPER,
  TARGET_MODELS,
  type Developer,
  type ModeId,
} from "@/lib/constants";
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
import { ArchiveMark, FolderMark, StarMark, UndoGlyph, XMark } from "@/components/ui/glyphs";
import { useSwipeActions } from "@/components/library/use-swipe-actions";
import { DeveloperIcon } from "@/components/models/DeveloperIcon";

export type { PromptCard } from "@/lib/library/queries";

const MODEL_LABEL_MAP = new Map<string, string>(
  TARGET_MODELS.map((m) => [m.id, m.label]),
);

/** Developer for a stored target id.  Tolerant like MODEL_LABEL_MAP above:
 *  PromptCard.target_model is typed `string`, so a card can hold an id this
 *  build no longer knows, and DeveloperIcon destructures PATHS[developer] —
 *  which throws on an unknown key and would blank-screen the whole library.
 *  LEGACY_TARGET_IDS is folded in so a renamed id keeps its colour rather than
 *  silently losing its mark. */
const MODEL_DEVELOPER_MAP = new Map<string, Developer>([
  ...TARGET_MODELS.map((m) => [m.id, m.developer] as const),
  ...Object.entries(LEGACY_TARGET_IDS).map(
    ([legacy, current]) => [legacy, TARGET_DEVELOPER[current]] as const,
  ),
]);

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
  /** The keyset cursor, but ONLY once we have paged past the server's first
   *  page. `undefined` = not paged yet — use the `nextCursor` prop, the
   *  boundary of whatever page 1 the server most recently rendered. Holding
   *  the prop in `useState` was the DraftsList bug replayed here (LIB-003):
   *  state never re-initialises on `router.refresh()`, so a mutation that
   *  displaced a row onto page 2 left a stale boundary that skipped it
   *  forever. `null` is a real answer: paged, and there is no next page. */
  const [pagedCursor, setPagedCursor] = useState<string | null | undefined>(undefined);
  const cursor = pagedCursor === undefined ? nextCursor : pagedCursor;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, startLoadMore] = useTransition();
  /** Owns router.refresh() so `cursor` cannot fall back to a stale prop while
   *  the refreshed page 1 is still in flight — see DraftsList for the full
   *  account of why the refresh needs its own synchronous transition. */
  const [refreshing, startRefresh] = useTransition();
  const [menuFor, setMenuFor] = useState<PromptCard | null>(null);

  /** Every mutation funnels here: drop the accumulated pages and the paged
   *  cursor BEFORE re-rendering page 1, so refreshed rows can't duplicate
   *  stale copies and the next Load more pages from the current boundary. */
  function refreshAfterMutation() {
    setExtraCards([]);
    setPagedCursor(undefined);
    startRefresh(() => router.refresh());
  }

  // Belt to the reset's braces: never render the same card twice even if a
  // refreshed page 1 overlaps a just-loaded extra page.
  const seenIds = new Set(initialCards.map((c) => c.id));
  const cards = [...initialCards, ...extraCards.filter((c) => !seenIds.has(c.id))];
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
      refreshAfterMutation();
      toast({
        text: "Moved to Recently deleted",
        action: {
          label: "Undo",
          onAction: () => {
            void undoDeletePromptAction(p.id).then(() => refreshAfterMutation());
          },
        },
      });
    });
  }

  /** Swipe-right favorite toggle. */
  function swipeFavorite(p: PromptCard) {
    void setFavoriteAction(p.id, !p.favorite).then((res) => {
      if (!res.ok) setLoadError(res.error ?? "Couldn't update favorites.");
      else refreshAfterMutation();
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
        setPagedCursor(res.nextCursor ?? null);
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
          label={
            <>
              <StarMark className="h-3.5 w-3.5 shrink-0" />
              Favorites
            </>
          }
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
          disabled={loadingMore || refreshing}
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
          onMutated={refreshAfterMutation}
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
  onMutated,
}: {
  prompt: PromptCard;
  collections: LibraryFacets["collections"];
  onClose: () => void;
  /** Notify the browser a write landed — it resets pagination + refreshes
   *  (LIB-003); the sheet must never call router.refresh() itself. */
  onMutated: () => void;
}) {
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
      onMutated();
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
      onMutated();
      onClose();
      toast({
        text: "Moved to Recently deleted",
        action: {
          label: "Undo",
          onAction: () => {
            void undoDeletePromptAction(id).then(() => onMutated());
          },
        },
      });
    });
  }

  const itemClass =
    "glass font-body flex min-h-[44px] w-full items-center justify-between rounded-xl px-4 text-sm text-text hover-hair transition-colors disabled:opacity-60";

  // Recently-deleted prompts get the recovery sheet (Q9): restore is the
  // headline, permanent deletion is the explicit, confirmed alternative —
  // nothing else applies to a prompt that no list shows.
  if (prompt.deleted) {
    return (
      <Sheet open onClose={onClose} title={prompt.title}>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => undoDeletePromptAction(prompt.id))}
            className={itemClass}
          >
            Restore
            <UndoGlyph className="h-4 w-4 shrink-0 text-accent" />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmPurge(true)}
            className="btn-destructive font-body flex min-h-[44px] w-full items-center justify-between rounded-xl px-4 text-sm disabled:opacity-60"
          >
            Delete permanently
            <XMark className="h-4 w-4 shrink-0" />
          </button>
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
      </Sheet>
    );
  }

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
            <StarMark className="h-4 w-4 shrink-0 text-accent" />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setArchivedAction(prompt.id, !prompt.archived))}
            className={itemClass}
          >
            {prompt.archived ? "Unarchive" : "Archive"}
            <ArchiveMark className="h-4 w-4 shrink-0" />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setMoveOpen(true)}
            className={itemClass}
          >
            Move to collection…
            <FolderMark className="h-4 w-4 shrink-0" />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={softDelete}
            className="btn-destructive font-body flex min-h-[44px] w-full items-center justify-between rounded-xl px-4 text-sm disabled:opacity-60"
          >
            Delete
            <XMark className="h-4 w-4 shrink-0" />
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
  const developer = MODEL_DEVELOPER_MAP.get(p.target_model);
  // Trash rows (Q9): the swipe verbs (favorite / soft-delete) don't apply to
  // an already-deleted prompt — gestures off, panels unrendered; recovery
  // lives in the actions sheet.
  const inTrash = p.deleted;
  // PER SIDE, never one shared flag — otherwise dragging one way lights the
  // panel on the other edge too and puts the bleed straight back.
  // Displacement first, `open` second: `open` is set only at pointer-up while
  // `offset` moves continuously, so gating on `open` alone would drag the card
  // off an empty gutter for the whole gesture and pop the colour in at release.
  const leftOn = swipe.offset > 0 || swipe.open === "left";
  const rightOn = swipe.offset < 0 || swipe.open === "right";
  const displaced = swipe.offset !== 0 || swipe.open !== null;
  // Reveal is INSTANT; only the close fades. A flick covers the full 84px well
  // under 150ms, and a fade-IN would show the action glyph at transiently
  // reduced contrast over the page background. close() sets dx=0 and open=null
  // in one commit, so without the fade-OUT the user sees an empty gutter for
  // the 150ms the card is still sliding home.
  const panel = (on: boolean) =>
    "absolute inset-y-0 flex " +
    (on
      ? "opacity-100"
      : "pointer-events-none opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none");
  return (
    <li
      // `scroll-row` (content-visibility) makes scroll cost independent of how
      // many prompts are saved: off-screen rows skip layout, paint and — the
      // expensive part — the card's backdrop blur. Safe on this element
      // specifically because its paint containment clips nothing that isn't
      // already clipped: the row is `overflow-hidden` for the swipe, so its
      // focus indicator is already drawn inset by `.dev-edge`.
      className="scroll-row relative overflow-hidden rounded-2xl"
      // Two consumers sit on opposite sides of the <a> — .dev-mark inside it
      // and .dev-edge after it — so the value is carried here. It arrives as
      // an inline custom property rather than a composed Tailwind class
      // because the config scans source text only, so `bg-[${hex}]` would
      // generate nothing.
      style={
        developer
          ? ({ "--dev": `var(--dev-${developer})` } as CSSProperties)
          : undefined
      }
    >
      {/* Actions sit UNDER the card and are revealed by sliding it. They are
          real buttons, but the ⋯ menu remains the discoverable, keyboard- and
          screen-reader-reachable path — swipe is an accelerator.

          They are also hidden at rest. The card above is .glass, which
          transmits 28% in dark, so a permanently-painted panel showed straight
          through it: every row carried an olive left edge and a muddy red
          right edge, constant and model-independent. */}
      {!inTrash && (
      <div aria-hidden={swipe.open === null} className={`${panel(leftOn)} left-0`}>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            onFavorite(p);
            swipe.close();
          }}
          className="flex w-[84px] items-center justify-center rounded-l-2xl bg-laser text-lg text-on-laser"
        >
          <StarMark className="h-5 w-5" />
          <span className="sr-only">
            {p.favorite ? `Remove ${p.title} from favorites` : `Favorite ${p.title}`}
          </span>
        </button>
      </div>
      )}
      {!inTrash && (
      <div aria-hidden={swipe.open === null} className={`${panel(rightOn)} right-0`}>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            onDelete(p);
            swipe.close();
          }}
          // --on-flare, not --on-laser: on the LIGHT theme's --flare #c81d10
          // the Void ink measures 3.30:1, an AA fail for this glyph. Dark is
          // byte-identical at 5.94:1; light flips to white at 5.77:1.
          // Sanctioned --flare FILL (DSN-012 / ADR-0004): flare is text/border
          // only everywhere else, but a full-bleed destructive swipe panel is
          // the one place the fill IS the signal; --on-flare ink pairs at
          // >=5.7:1 in both themes.
          className="flex w-[84px] items-center justify-center rounded-r-2xl bg-flare text-lg text-[color:var(--on-flare)]"
        >
          <XMark className="h-5 w-5" />
          <span className="sr-only">Delete {p.title}</span>
        </button>
      </div>
      )}
      <div
        {...(inTrash ? {} : swipe.handlers)}
        onClickCapture={swipe.onClickCapture}
        style={swipe.style}
        className="relative transition-transform duration-150 ease-out motion-reduce:transition-none"
      >
      <Link
        href={`/library/${p.id}`}
        className="glass hover-hair block rounded-2xl p-4 pr-12 transition-colors"
      >
        {/* gap-2 rather than gap-3 reclaims 4px of the 20px the mark costs the
            wrapping title column, so the net cost is 16px. The title has no
            truncate and no line-clamp, so nothing is lost — it reflows. */}
        <div className="flex items-start justify-between gap-2">
          <p className="font-body min-w-0 text-base text-text">
            {p.favorite && (
              // --silver, not the Laser accent: the star is already redundant
              // with the Favorites chip and the swipe action, and it was the
              // only element competing with the developer mark for the same
              // glance. The label is unchanged.
              <span aria-label="Favorite" className="mr-1 text-silver">
                <StarMark className="inline-block h-[0.8em] w-[0.8em] align-[-0.02em]" />
              </span>
            )}
            {p.title}
          </p>
          {/* leading-6 gives this span a 24px first-line box to match the
              title's, so a 16px mark centres against the title's cap line
              instead of floating above it in an items-start row. */}
          <span className="font-body inline-flex shrink-0 items-center gap-1 text-xs leading-6 text-silver">
            {developer && (
              <DeveloperIcon
                developer={developer}
                className="dev-mark h-4 w-4 shrink-0"
              />
            )}
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
          {collectionName ? (
            <>
              {" · "}
              <FolderMark className="inline-block h-[1em] w-[1em] align-[-0.125em]" />{" "}
              {collectionName}
            </>
          ) : (
            ""
          )}
          {p.tags.length > 0 ? ` · ${p.tags.map((t) => `#${t}`).join(" ")}` : ""}
        </p>
      </Link>
      {/* Identity field + the card's focus ring, in one overlay. It has to be
          a SIBLING of the <a> rather than a child: an inset box-shadow paints
          below its own element's descendants, so a ring drawn inside the card
          would sit under the card's text. `data-swiping` drops the field while
          a row is displaced, so the only chromatic signal on the trailing edge
          during a drag is the action colour. */}
      <span
        aria-hidden="true"
        className="dev-edge"
        data-swiping={displaced ? "" : undefined}
      />
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
  label: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "tap-44 font-body inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
        active ? "selected-ink bg-laser text-on-laser" : "glass text-silver hover:text-chalk",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

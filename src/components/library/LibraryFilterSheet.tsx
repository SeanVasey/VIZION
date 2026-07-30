"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import { MODES, TARGET_MODELS } from "@/lib/constants";
import { DeveloperIcon } from "@/components/models/DeveloperIcon";
import {
  LIBRARY_SORTS,
  LIBRARY_VIEWS,
  libraryHref,
  type LibraryFilter,
  type LibrarySort,
  type LibraryView,
} from "@/lib/library/paging";
import type { LibraryFacets } from "@/lib/library/queries";
import { groupModelFacets, type FacetModel } from "@/lib/library/model-facets";

const MODEL_META = new Map(TARGET_MODELS.map((m) => [m.id, m]));

/** Module scope so the chip renderer below can share it with the sheet. */
const chipClass = (active: boolean) =>
  [
    "tap-44 font-body inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
    active ? "bg-laser text-on-laser" : "glass text-silver hover:text-chalk",
  ].join(" ");

/** Decorate a bare facet for the flat (ungrouped) path, so both paths render
 *  through the same chip. */
function decorate(m: { id: string; count: number }): FacetModel {
  const meta = MODEL_META.get(m.id as (typeof TARGET_MODELS)[number]["id"]);
  return { ...m, label: meta?.label ?? m.id, developer: meta?.developer ?? null };
}

function ModelChip({
  model,
  active,
  onPick,
}: {
  model: FacetModel;
  active: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onPick(model.id)}
      className={chipClass(active)}
    >
      {/* On a Laser fill the chip's own `text-on-laser` ink governs the mark
          (guardrail §6), so the accent tint is dropped when active. */}
      {model.developer && (
        <DeveloperIcon
          developer={model.developer}
          className={`h-3.5 w-3.5 shrink-0 ${active ? "" : "text-accent"}`}
        />
      )}
      {model.label}
      <span className={active ? "opacity-80" : "opacity-60"}>{model.count}</span>
    </button>
  );
}

const VIEW_LABEL: Record<LibraryView, string> = {
  all: "All",
  favorites: "Favorites",
  archived: "Archived",
  // Reads as a fourth view, but it lists a different relation — see
  // `isDraftsView`. The Record is exhaustive over LibraryView on purpose:
  // adding a view without a label is a type error, not a blank chip.
  drafts: "Drafts",
};

const SORT_LABEL: Record<LibrarySort, string> = {
  updated: "Recently edited",
  created: "Recently created",
  title: "Title A–Z",
};

/**
 * The library filter sheet (2026-07 UX audit): model/mode/tag/view/sort in
 * one summoned surface. Models show ONLY what the user's library contains,
 * with counts — never the sixteen-chip global roster wall.
 */
export function LibraryFilterSheet({
  open,
  onClose,
  filter,
  facets,
}: {
  open: boolean;
  onClose: () => void;
  filter: LibraryFilter;
  facets: LibraryFacets;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<LibraryFilter>(filter);
  // Re-seed whenever the sheet opens against a (possibly new) URL state.
  useEffect(() => {
    if (open) setPending(filter);
  }, [open, filter]);

  function apply() {
    router.push(libraryHref(pending));
    onClose();
  }

  function clearAll() {
    setPending({ view: "all", sort: "updated", ...(filter.q ? { q: filter.q } : {}) });
  }

  const section = "font-body text-xs uppercase tracking-wider text-silver";
  const chip = chipClass;

  const modelGroups = useMemo(
    () => groupModelFacets(facets.models),
    [facets.models],
  );
  const pickModel = (id: string) =>
    setPending((p) => ({ ...p, model: id as LibraryFilter["model"] }));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filter & sort"
      footer={
        <div className="grid grid-cols-[1fr_1.5fr] gap-2">
          <button
            type="button"
            onClick={clearAll}
            className="btn-secondary flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={apply}
            className="btn-laser flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm"
          >
            Apply
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {/* View. */}
        <section aria-label="View" className="flex flex-col gap-2">
          <p className={section}>View</p>
          <div className="flex flex-wrap gap-2">
            {LIBRARY_VIEWS.map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={pending.view === view}
                onClick={() => setPending((p) => ({ ...p, view }))}
                className={chip(pending.view === view)}
              >
                {VIEW_LABEL[view]}
              </button>
            ))}
          </div>
        </section>

        {/* Model — only what the library contains, with counts. */}
        <section aria-label="Model" className="flex flex-col gap-2">
          <p className={section}>Model</p>
          {facets.models.length === 0 ? (
            <p className="font-body text-xs text-silver">
              Save a prompt and its model will appear here.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={!pending.model}
                onClick={() =>
                  setPending((p) => {
                    const next = { ...p };
                    delete next.model;
                    return next;
                  })
                }
                className={chip(!pending.model)}
              >
                Any
              </button>
              {modelGroups === null &&
                facets.models.map((m) => (
                  <ModelChip
                    key={m.id}
                    model={decorate(m)}
                    active={pending.model === m.id}
                    onPick={pickModel}
                  />
                ))}
            </div>
          )}
          {/* Grouped only when the library spans more than one developer —
              headers over a single-developer library would say the same thing
              twice. groupModelFacets owns that rule; null means "stay flat". */}
          {modelGroups?.map((group) => (
            <div key={group.label} className="flex flex-col gap-1.5">
              <p className="font-body px-0.5 text-[0.625rem] uppercase tracking-[0.18em] text-silver">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.models.map((m) => (
                  <ModelChip
                    key={m.id}
                    model={m}
                    active={pending.model === m.id}
                    onPick={pickModel}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* Mode. */}
        <section aria-label="Mode" className="flex flex-col gap-2">
          <p className={section}>Mode</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={!pending.mode}
              onClick={() =>
                setPending((p) => {
                  const next = { ...p };
                  delete next.mode;
                  return next;
                })
              }
              className={chip(!pending.mode)}
            >
              Any
            </button>
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={pending.mode === m.id}
                onClick={() => setPending((p) => ({ ...p, mode: m.id }))}
                className={chip(pending.mode === m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </section>

        {/* Tags. */}
        {facets.tags.length > 0 && (
          <section aria-label="Tag" className="flex flex-col gap-2">
            <p className={section}>Tag</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={!pending.tag}
                onClick={() =>
                  setPending((p) => {
                    const next = { ...p };
                    delete next.tag;
                    return next;
                  })
                }
                className={chip(!pending.tag)}
              >
                Any
              </button>
              {facets.tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={pending.tag === t}
                  onClick={() => setPending((p) => ({ ...p, tag: t }))}
                  className={chip(pending.tag === t)}
                >
                  #{t}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Sort. */}
        <section aria-label="Sort" className="flex flex-col gap-2">
          <p className={section}>Sort</p>
          <div className="flex flex-wrap gap-2">
            {LIBRARY_SORTS.map((sort) => (
              <button
                key={sort}
                type="button"
                aria-pressed={pending.sort === sort}
                onClick={() => setPending((p) => ({ ...p, sort }))}
                className={chip(pending.sort === sort)}
              >
                {SORT_LABEL[sort]}
              </button>
            ))}
          </div>
        </section>

        {/* Collections — the user's folders, with counts. Hidden until one
            exists (created from a card's "Move to collection…"). */}
        {facets.collections.length > 0 && (
          <section aria-label="Collection" className="flex flex-col gap-2">
            <p className={section}>Collection</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={!pending.collection}
                onClick={() =>
                  setPending((p) => {
                    const next = { ...p };
                    delete next.collection;
                    return next;
                  })
                }
                className={chip(!pending.collection)}
              >
                Any
              </button>
              {facets.collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={pending.collection === c.id}
                  onClick={() => setPending((p) => ({ ...p, collection: c.id }))}
                  className={chip(pending.collection === c.id)}
                >
                  {c.name}
                  <span
                    className={pending.collection === c.id ? "opacity-80" : "opacity-60"}
                  >
                    {c.count}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </Sheet>
  );
}

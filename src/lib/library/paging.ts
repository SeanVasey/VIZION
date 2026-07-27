import { MODES, TARGET_MODELS, type ModeId, type TargetModelId } from "@/lib/constants";

/**
 * Library filter + cursor plumbing (2026-07 UX audit): filtering is
 * server-side, driven by URL searchParams (shareable, back-button-friendly,
 * server as source of truth), with keyset cursor pagination. Pure and
 * unit-tested; the Supabase query lives in queries.ts.
 */

export const LIBRARY_PAGE_SIZE = 30;

export const LIBRARY_VIEWS = ["all", "favorites", "archived"] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

export const LIBRARY_SORTS = ["updated", "created", "title"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export interface LibraryFilter {
  /** Title search (ilike, title only — tags have their own filter). */
  q?: string;
  model?: TargetModelId;
  mode?: ModeId;
  tag?: string;
  /** Collection id (uuid). Unlike model/mode, the valid set is per-user and
   *  dynamic — only the SHAPE is validated here; an unknown id simply
   *  matches nothing (RLS scopes the rows anyway). */
  collection?: string;
  view: LibraryView;
  sort: LibrarySort;
}

const MODEL_IDS = new Set<string>(TARGET_MODELS.map((m) => m.id));
const MODE_IDS = new Set<string>(MODES.map((m) => m.id));
const VIEW_IDS = new Set<string>(LIBRARY_VIEWS);
const SORT_IDS = new Set<string>(LIBRARY_SORTS);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse raw searchParams tolerantly — garbage falls back to defaults. */
export function parseLibraryParams(
  sp: Record<string, string | string[] | undefined> | undefined,
): LibraryFilter {
  const one = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const q = one(sp?.q)?.trim().slice(0, 200);
  const model = one(sp?.model);
  const mode = one(sp?.mode);
  const tag = one(sp?.tag)?.trim().slice(0, 60);
  const collection = one(sp?.collection)?.trim();
  const view = one(sp?.view);
  const sort = one(sp?.sort);
  return {
    ...(q ? { q } : {}),
    ...(model && MODEL_IDS.has(model) ? { model: model as TargetModelId } : {}),
    ...(mode && MODE_IDS.has(mode) ? { mode: mode as ModeId } : {}),
    ...(tag ? { tag } : {}),
    ...(collection && UUID_RE.test(collection) ? { collection } : {}),
    view: view && VIEW_IDS.has(view) ? (view as LibraryView) : "all",
    sort: sort && SORT_IDS.has(sort) ? (sort as LibrarySort) : "updated",
  };
}

/** The URL for a filter state (defaults are omitted — `/library` stays clean). */
export function libraryHref(filter: LibraryFilter): string {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.model) params.set("model", filter.model);
  if (filter.mode) params.set("mode", filter.mode);
  if (filter.tag) params.set("tag", filter.tag);
  if (filter.collection) params.set("collection", filter.collection);
  if (filter.view !== "all") params.set("view", filter.view);
  if (filter.sort !== "updated") params.set("sort", filter.sort);
  const s = params.toString();
  return s ? `/library?${s}` : "/library";
}

/** Count of narrowing selections — the filter button's badge. Search is
 *  excluded (it's visible in the field itself). */
export function countActiveFilters(filter: LibraryFilter): number {
  return [
    filter.model,
    filter.mode,
    filter.tag,
    filter.collection,
    filter.view !== "all" ? "view" : undefined,
    filter.sort !== "updated" ? "sort" : undefined,
  ].filter(Boolean).length;
}

const CURSOR_SEP = "\u001f";

/** Keyset cursor: the sort column's value + the row id (stable tiebreak). */
export function encodeCursor(value: string, id: string): string {
  return `${value}${CURSOR_SEP}${id}`;
}

export function decodeCursor(raw: string): { value: string; id: string } | null {
  const i = raw.indexOf(CURSOR_SEP);
  if (i <= 0) return null;
  const value = raw.slice(0, i);
  const id = raw.slice(i + 1);
  if (!id) return null;
  return { value, id };
}

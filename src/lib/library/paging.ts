import { MODES, TARGET_MODELS, type ModeId, type TargetModelId } from "@/lib/constants";

/**
 * Library filter + cursor plumbing (2026-07 UX audit): filtering is
 * server-side, driven by URL searchParams (shareable, back-button-friendly,
 * server as source of truth), with keyset cursor pagination. Pure and
 * unit-tested; the Supabase query lives in queries.ts.
 */

export const LIBRARY_PAGE_SIZE = 30;

/** Escape ilike wildcards in user input, so a literal % or _ in a search term
 *  matches itself instead of everything. Shared by library and drafts queries
 *  (SEC-004) — an escaping fix must land in one place, never two. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Quote a value for a PostgREST `or=()` expression. A search term can contain
 *  commas and parens, which would otherwise break the filter grammar and turn a
 *  harmless query into a 400 (or, worse, a different filter). */
export function quoteOrValue(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * `drafts` is a view over a DIFFERENT relation (public.drafts), not a filter on
 * prompts. It lives in this union anyway so the view switch, the URL shape, the
 * filter badge and the back button all keep working through it — the alternative
 * was a second parallel notion of "which library screen am I on".
 *
 * The consequence is that `queryLibraryPage` must never be called for it, since
 * it would silently return prompts. `library/page.tsx` branches first;
 * `isDraftsView` is the single predicate both sides read.
 */
// "trash" is ruling Q9's persistent recovery surface: soft-deleted prompts
// were recoverable only through a 6-second toast Undo (WCAG 2.2.1) — now the
// Undo is a shortcut and Recently deleted is the durable path.
export const LIBRARY_VIEWS = ["all", "favorites", "archived", "trash", "drafts"] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

/** Does this filter target the drafts relation rather than prompts? */
export function isDraftsView(filter: Pick<LibraryFilter, "view">): boolean {
  return filter.view === "drafts";
}

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
  // The cursor is CLIENT-SUPPLIED and both halves are interpolated into
  // PostgREST .or() grammar (SEC-004): a crafted id like
  // "x,id.not.is.null" injects extra OR branches (RLS-confined, but a
  // filter-grammar hole is a hole). The id must be the UUID the server
  // minted; a mismatch means a tampered cursor → fresh first page.
  if (!UUID_RE.test(id)) return null;
  return { value, id };
}

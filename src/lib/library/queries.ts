import "server-only";
import type { createClient } from "@/lib/supabase/server";
import {
  LIBRARY_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  type LibraryFilter,
  type LibrarySort,
} from "@/lib/library/paging";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** One library card — everything the list renders, no version bodies. */
export interface PromptCard {
  id: string;
  title: string;
  target_model: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  favorite: boolean;
  archived: boolean;
  preview: string | null;
  mode: string | null;
  versions: number;
}

export interface LibraryFacets {
  /** Models actually present in the (non-deleted) library, with counts —
   *  the filter sheet shows ONLY these, never the full global roster. */
  models: { id: string; count: number }[];
  tags: string[];
}

const SORT_SPEC: Record<
  LibrarySort,
  { column: "updated_at" | "created_at" | "title"; ascending: boolean }
> = {
  updated: { column: "updated_at", ascending: false },
  created: { column: "created_at", ascending: false },
  title: { column: "title", ascending: true },
};

/** Escape ilike wildcards in user input. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Quote a value for a PostgREST or=() expression (titles can contain commas
 *  and parens, which would otherwise break the filter grammar). */
function quoteOrValue(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

interface PageRow {
  id: string;
  title: string;
  target_model: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  favorite: boolean;
  archived_at: string | null;
  preview: string | null;
  current_mode: string | null;
  prompt_versions: { count: number }[] | null;
}

/**
 * One page of library cards, filtered + keyset-paginated server-side. The
 * version count is the embedded aggregate (`prompt_versions!prompt_id(count)`
 * — disambiguated because prompts.current_ver is a second FK path), replacing
 * the old one-row-per-version client counting.
 */
export async function queryLibraryPage(
  supabase: Supabase,
  filter: LibraryFilter,
  cursorRaw?: string,
): Promise<{ cards: PromptCard[]; nextCursor: string | null }> {
  const spec = SORT_SPEC[filter.sort];
  let q = supabase
    .from("prompts")
    .select(
      "id, title, target_model, tags, created_at, updated_at, favorite, archived_at, preview, current_mode, prompt_versions!prompt_id(count)",
    )
    .is("deleted_at", null);

  if (filter.view === "favorites") q = q.eq("favorite", true).is("archived_at", null);
  else if (filter.view === "archived") q = q.not("archived_at", "is", null);
  else q = q.is("archived_at", null);
  if (filter.model) q = q.eq("target_model", filter.model);
  if (filter.mode) q = q.eq("current_mode", filter.mode);
  if (filter.tag) q = q.contains("tags", [filter.tag]);
  if (filter.q) q = q.ilike("title", `%${escapeLike(filter.q)}%`);

  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  if (cursor) {
    const op = spec.ascending ? "gt" : "lt";
    const v = spec.column === "title" ? quoteOrValue(cursor.value) : cursor.value;
    q = q.or(`${spec.column}.${op}.${v},and(${spec.column}.eq.${v},id.lt.${cursor.id})`);
  }

  const { data, error } = await q
    .order(spec.column, { ascending: spec.ascending })
    .order("id", { ascending: false })
    .limit(LIBRARY_PAGE_SIZE + 1);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as PageRow[];
  const page = rows.slice(0, LIBRARY_PAGE_SIZE);
  const cards: PromptCard[] = page.map((row) => ({
    id: row.id,
    title: row.title,
    target_model: row.target_model,
    tags: row.tags,
    created_at: row.created_at,
    updated_at: row.updated_at,
    favorite: row.favorite,
    archived: row.archived_at !== null,
    preview: row.preview,
    mode: row.current_mode,
    versions: row.prompt_versions?.[0]?.count ?? 1,
  }));
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > LIBRARY_PAGE_SIZE && last
      ? encodeCursor(String(last[spec.column]), last.id)
      : null;
  return { cards, nextCursor };
}

/** Facets for the filter sheet. PostgREST aggregates are disabled on the
 *  hosted project (PGRST123 — probed 2026-07-27), so this reduces a capped
 *  column-only select instead of a grouped count. */
export async function queryLibraryFacets(supabase: Supabase): Promise<LibraryFacets> {
  const { data } = await supabase
    .from("prompts")
    .select("target_model, tags")
    .is("deleted_at", null)
    .limit(1000);
  const counts = new Map<string, number>();
  const tags = new Set<string>();
  for (const row of data ?? []) {
    counts.set(row.target_model, (counts.get(row.target_model) ?? 0) + 1);
    for (const t of row.tags ?? []) tags.add(t);
  }
  return {
    models: [...counts.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    tags: [...tags].sort(),
  };
}

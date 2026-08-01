import "server-only";
import type { createClient } from "@/lib/supabase/server";
import {
  LIBRARY_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  type LibraryFilter,
} from "@/lib/library/paging";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * PostgREST's code for "that relation isn't in the schema cache" — what every
 * read here returns until `20260730012046_drafts.sql` is applied.
 *
 * The migration lands by hand (owner applies it), so there is a window where
 * the client knows about drafts and the database does not. In that window the
 * Drafts view must render "No drafts" — an empty feature — rather than the
 * library's "Couldn't load your library" alert, which would be both wrong and
 * alarming about data that is fine. Every other error still throws: a real
 * failure must not be laundered into "you have nothing saved", which is the
 * exact mistake `library/page.tsx` already guards against in its own catch.
 */
const UNDEFINED_TABLE = "PGRST205";

export function isMissingDraftsTable(error: { code?: string | null } | null): boolean {
  return error?.code === UNDEFINED_TABLE;
}

/** Escape ilike wildcards in user input, so a literal % or _ in a search term
 *  matches itself instead of everything. Mirrors `library/queries.ts`. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Quote a value for a PostgREST `or=()` expression. A search term can contain
 *  commas and parens, which would otherwise break the filter grammar and turn a
 *  harmless query into a 400 (or, worse, a different filter). */
function quoteOrValue(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** One Drafts-list row. Bodies are NOT fetched — the list renders the title
 *  and preview only, and resuming fetches the body by id. */
export interface DraftCard {
  id: string;
  title: string;
  preview: string;
  target_model: string;
  mode: string;
  thinking_level: string | null;
  created_at: string;
  updated_at: string;
}

/** How much of the body the list row shows. */
const PREVIEW_CHARS = 160;

interface DraftRow {
  id: string;
  title: string;
  body: string;
  target_model: string;
  mode: string;
  thinking_level: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One page of drafts, newest-updated first, keyset-paginated on
 * (updated_at, id) — the same shape and page size as the library page, so the
 * Drafts view's "Load more" behaves identically.
 *
 * `body` is selected because the preview is derived from it; only the first
 * PREVIEW_CHARS survive into the card, so no full body crosses into the client
 * payload for a list of 30.
 */
export async function queryDraftsPage(
  supabase: Supabase,
  filter: LibraryFilter,
  cursorRaw?: string,
): Promise<{ cards: DraftCard[]; nextCursor: string | null; unavailable: boolean }> {
  let q = supabase
    .from("drafts")
    .select("id, title, body, target_model, mode, thinking_level, created_at, updated_at");

  // Search covers the BODY as well as the title. A draft's title is derived
  // from its first line, so title-only search (what the prompts library does,
  // where the user names the prompt) would miss everything the draft is
  // actually about. `or` rather than two filters — those would AND.
  if (filter.q) {
    const like = `%${escapeLike(filter.q)}%`;
    q = q.or(`title.ilike.${quoteOrValue(like)},body.ilike.${quoteOrValue(like)}`);
  }
  // model/mode are real draft columns, so they narrow here too. tag/collection
  // are prompts-only and have nothing to match — they stay ignored rather than
  // being reinterpreted into something the user did not ask for.
  if (filter.model) q = q.eq("target_model", filter.model);
  if (filter.mode) q = q.eq("mode", filter.mode);

  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  if (cursor) {
    // Quoted + UUID-pinned for the same reason as queryLibraryPage (SEC-004).
    const v = quoteOrValue(cursor.value);
    q = q.or(`updated_at.lt.${v},and(updated_at.eq.${v},id.lt.${cursor.id})`);
  }

  const { data, error } = await q
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIBRARY_PAGE_SIZE + 1);

  if (error) {
    if (isMissingDraftsTable(error)) {
      return { cards: [], nextCursor: null, unavailable: true };
    }
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as DraftRow[];
  const page = rows.slice(0, LIBRARY_PAGE_SIZE);
  const cards: DraftCard[] = page.map((row) => ({
    id: row.id,
    title: row.title,
    preview: row.body.slice(0, PREVIEW_CHARS),
    target_model: row.target_model,
    mode: row.mode,
    thinking_level: row.thinking_level,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > LIBRARY_PAGE_SIZE && last
      ? encodeCursor(last.updated_at, last.id)
      : null;
  return { cards, nextCursor, unavailable: false };
}

/** Models actually present in the user's drafts, with counts — so the Drafts
 *  view's own filter offers only what is there, the same rule the prompts
 *  library's model facet follows. `null` = unavailable (migration pending). */
export async function queryDraftModelFacets(
  supabase: Supabase,
): Promise<{ id: string; count: number }[] | null> {
  // Ordered for the same reason as queryLibraryFacets (LIB-005): an
  // unordered 1000-row slice makes the facet counts arbitrary past the cap.
  const { data, error } = await supabase
    .from("drafts")
    .select("target_model")
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) return null;
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.target_model, (counts.get(row.target_model) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}
